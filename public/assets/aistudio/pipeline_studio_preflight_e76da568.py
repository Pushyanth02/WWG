#!/usr/bin/env python3
"""Archmage v3.1 cautious 5-stage-prep tool (Python+OpenCV+scikit-image).

Creates REVIEW CANDIDATES, NOT VERIFIED PRODUCTION SPRITES.
- Classifies by alpha and border appearance.
- Border-connected flood fills only studio white (other classes left unchanged).
- Detects 8-connected components, Sobel/alpha-energy vertical seam, ordered external contours.
- Makes selective neutral-outline CIELAB snap preview with CIEDE2000 heatmap.
- Guesses bottom-slice foot centroids for connected candidates, not animation frames.
- Emits audit JSON and visual overlay; never asserts animation parity before frame extraction.

Run: python 05_TOOLS/pipeline_studio_preflight.py --image 01_SOURCE_4K/...png --dest 03_CLEANUP_REVIEW_CANDIDATES/example --max-long-edge 1024
Use --full to output a 4K cleanup candidate (only when studio-white class is confidently detected).
"""
import argparse, json, math, time
from pathlib import Path
import numpy as np, cv2
from PIL import Image
from skimage import color

INK=np.array([20,14,29], dtype=np.uint8)
RAMP=np.array([[23,19,33],[41,36,49],[56,52,65],[81,71,91],[113,103,122],[153,139,162]],dtype=np.uint8)

def classify(image):
    rgba=np.asarray(image.convert('RGBA'))
    rgb=rgba[:,:,:3];a=rgba[:,:,3]
    border=np.concatenate([rgb[0],rgb[-1],rgb[:,0],rgb[:,-1]])
    near_white=(np.min(border,axis=1)>228).mean()
    dark=(np.max(border,axis=1)<40).mean()
    z=(a==0).mean()
    if z>.14 and near_white<.3: typ='true_alpha'
    elif z>.005:typ='mixed_alpha_or_baked_backdrop'
    elif near_white>.64:typ='studio_white_baked'
    elif dark>.66:typ='dark_obsidian_baked'
    elif near_white>.36:typ='light_or_checkerboard_baked'
    else:typ='illustrated_opaque_composite'
    return typ,{'near_white_border_frac':float(near_white),'near_black_border_frac':float(dark),'transparent_frac':float(z)}

def white_border_floodfill(image, threshold=231):
    """Only remove white/low-chroma pixels connected to exterior, leaving enclosed whites intact.
    Two-pass alpha fringe handling based on a white-matte approximation.
    """
    rgba=np.array(image.convert('RGBA'),copy=True)
    rgb=rgba[:,:,:3];orig_a=rgba[:,:,3]
    mini=rgb.min(axis=2).astype(np.int16);maxi=rgb.max(axis=2).astype(np.int16)
    chroma=maxi-mini
    bg=((mini>=threshold)&(chroma<=24)).astype('uint8')
    count,labels,stats,centroids=cv2.connectedComponentsWithStats(bg,8)
    edge=set(np.unique(np.concatenate((labels[0],labels[-1],labels[:,0],labels[:,-1]))).tolist())
    edge.discard(0)
    background=np.isin(labels,list(edge)) if edge else np.zeros(bg.shape, bool)
    # Preserve pre-existing true transparency by multiplying into new alpha.
    new_a=np.where(background,0,orig_a).astype('uint8')
    # pass 1: soften 1-pixel anti-aliased white fringe just INSIDE foreground.
    # Avoid touching colored highlights and white cores: only near light-gray, low-chroma border.
    adjacent=(cv2.dilate(background.astype('uint8'),np.ones((3,3),np.uint8),iterations=1)>0)&(~background)
    edge_light=(mini>176)&(chroma<34)&adjacent
    estimated=((255-mini.astype(np.float32))/(255-threshold))*255
    new_a[edge_light]=np.minimum(new_a[edge_light], np.clip(estimated[edge_light],45,240).astype(np.uint8))
    # pass 2: white-matte unblend for only semitransparent edges with foreground alpha > .15.
    decontam=(new_a>38)&(new_a<255)&adjacent
    if np.any(decontam):
        av=new_a[decontam].astype('float32')[:,None]/255
        C=rgb[decontam].astype('float32')
        correct=np.clip((C-(1-av)*255)/np.maximum(av,0.05),0,255)
        rgb[decontam]=correct.astype('uint8')
    rgba[:,:,:3]=rgb;rgba[:,:,3]=new_a
    return Image.fromarray(rgba,'RGBA'),{'border_connected_white_pixels_removed':int(background.sum()), 'edge_fringe_pixels_adjusted':int(edge_light.sum()),'halo_unblend_pixels':int(decontam.sum())}

def component_objects(alpha, min_area=15):
    foreground=(alpha>=105).astype(np.uint8)
    n, lab, stats, cent=cv2.connectedComponentsWithStats(foreground,8)
    parts=[]
    for i in range(1,n):
        x,y,w,h,area=stats[i]
        if area<min_area:continue
        parts.append({'id':i,'bbox':[int(x),int(y),int(w),int(h)],'area':int(area),'centroid':[float(cent[i][0]),float(cent[i][1])]})
    parts.sort(key=lambda e:e['area'],reverse=True)
    return parts,lab

def dp_min_energy_vertical(rgb,alpha,center_frac=0.5,half_window_frac=.2):
    """Min-energy seam from top to bottom near a chosen center; protect opaque edges.
    This returns a guide seam only; it does NOT cut frames or limbs automatically.
    """
    gray=cv2.cvtColor(rgb,cv2.COLOR_RGB2GRAY)
    dx=cv2.Sobel(gray,cv2.CV_32F,1,0,ksize=3)
    dy=cv2.Sobel(gray,cv2.CV_32F,0,1,ksize=3)
    grad=np.hypot(dx,dy)
    grad/=max(float(np.percentile(grad,96)),1.)
    energy=(alpha.astype('float32')/255)*6 + np.clip(grad,0,2.5)*3
    H,W=alpha.shape
    lo=max(0,round(W*(center_frac-half_window_frac)))
    hi=min(W,round(W*(center_frac+half_window_frac)))
    e=energy[:,lo:hi]
    if e.shape[1]<4:return []
    D=np.empty_like(e,dtype=np.float32)
    prev=np.zeros(e.shape,dtype=np.int8)
    D[0]=e[0]
    for y in range(1,H):
        left=np.r_[np.inf,D[y-1,:-1]]
        center=D[y-1]
        right=np.r_[D[y-1,1:],np.inf]
        candidates=np.stack((left,center,right),axis=0)
        pick=np.argmin(candidates,axis=0)
        D[y]=e[y]+np.take_along_axis(candidates,pick[None,:],axis=0)[0]
        prev[y]=pick.astype('int8')-1
    seam=np.empty(H,dtype='int32');seam[-1]=int(np.argmin(D[-1]))
    for y in range(H-1,0,-1):seam[y-1]=seam[y]+int(prev[y,seam[y]])
    return (seam+lo).tolist()

def outer_contours(binary,min_area=20,limit=20):
    """External ordered 8-neighbor border chains using CHAIN_APPROX_NONE (OpenCV)."""
    contours,_=cv2.findContours(binary.astype('uint8'),cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_NONE)
    contours=sorted(contours,key=cv2.contourArea,reverse=True)
    return [c[:,0,:].tolist() for c in contours if cv2.contourArea(c)>=min_area][:limit]

def feet_pivot_candidates(parts,seg_labels, max_items=20):
    out=[]
    for p in parts[:max_items]:
        x,y,w,h=p['bbox'];yy0=y+int(h*.8)
        roi=(seg_labels[yy0:y+h,x:x+w]==p['id'])
        ys,xs=np.nonzero(roi)
        if len(xs)<3:continue
        foot_x=float(x+xs.mean())
        baseline=int(yy0+ys.max())
        out.append({'bbox':p['bbox'],'feet_center_x':round(foot_x,2),'baseline_y':baseline,
                    'target_player_pivot':[32,54],'target_tyrant_pivot':[64,104],
                    'status':'UNVERIFIED_COMPONENT_NOT_AN_ANIMATION_FRAME'})
    return out

def quantize_neutral_lab(image, down=512):
    """Protect high-saturation elemental colors. Output is a preview, not automatic final palette rewrite."""
    preview=image.copy();preview.thumbnail((down,down),Image.Resampling.BOX)
    RGB=np.array(preview.convert('RGB'),dtype=np.uint8)
    srgb=RGB.astype('float32')/255
    lab=color.rgb2lab(srgb)
    chroma=np.sqrt(lab[:,:,1]**2+lab[:,:,2]**2)
    neutral=(chroma<13)&(lab[:,:,0]<36)&(lab[:,:,0]>1)
    # Measure ΔE for all pixels after selective ink snapping.
    snap=RGB.copy()
    ink_lab=color.rgb2lab(INK.reshape((1,1,3)).astype('float32')/255)[0,0]
    if np.any(neutral):
        d=color.deltaE_ciede2000(lab[neutral],ink_lab[None,:])
        hit=np.zeros(neutral.shape,bool)
        hit[neutral]=d<8
        snap[hit]=INK
    after_lab=color.rgb2lab(snap.astype('float32')/255)
    delta=color.deltaE_ciede2000(lab,after_lab)
    summary={'mean_delta_e00':float(np.mean(delta)),'p95_delta_e00':float(np.percentile(delta,95)),
             'snapped_fraction':float(np.mean(np.any(snap!=RGB,axis=2))),'quantization_preview_only':True}
    # Grayscale heatmap uses bright pixels for high delta; overlays over original RGB.
    heat=np.clip(delta/10,0,1)
    orange=(np.stack([np.full_like(heat,255),165*(1-heat),50*(1-heat)],axis=-1))
    over=np.where((heat>.02)[:,:,None], RGB*.45+orange*.55, RGB).astype('uint8')
    return Image.fromarray(snap,'RGB'),Image.fromarray(over,'RGB'),summary

def render_overlay(image,parts,contours,seam,pivots):
    rgba=np.array(image.convert('RGBA'))
    # overlays are intentionally non-authoritative QA, not merged into source
    overlay=rgba[:,:,:3].copy()
    for p in parts[:20]:
        x,y,w,h=p['bbox'];cv2.rectangle(overlay,(x,y),(x+w,y+h),(235,185,74),1)
    for path in contours[:8]:
        if len(path)<2:continue
        cv2.polylines(overlay,[np.asarray(path,dtype=np.int32)],True,(89,215,199),1)
    if seam:
        step=max(1,len(seam)//512)
        for yy in range(1,len(seam),step):
            x=seam[yy];overlay[yy,max(0,x-1):min(overlay.shape[1],x+2)]=(238,70,116)
    for pp in pivots[:8]:
        x=int(pp['feet_center_x']);y=int(pp['baseline_y'])
        cv2.circle(overlay,(x,y),3,(250,225,92),-1)
    return Image.fromarray(overlay,'RGB')

def work(path,dest,max_long_edge=1024,full=False,allow_soft=False):
    dest.mkdir(parents=True,exist_ok=True)
    source=Image.open(path)
    if full: im=source.convert('RGBA'); im.load()
    else:
        im=source.convert('RGBA')
        im.thumbnail((max_long_edge,max_long_edge),Image.Resampling.BOX)
    typ,basic=classify(im)
    warnings=[]
    stats={'source_path':str(path),'source_size':list(source.size),'processing_size':list(im.size),
           'backdrop_class':typ,'classification_details':basic,
           'input_kind':'flattened_concept_or_mixed_atlas','verified_frame_count':0}
    if typ=='studio_white_baked':
        candidate,cln=white_border_floodfill(im)
        stats['cleanup']=cln; stats['cleanup_applied_to_candidate']=True
    else:
        candidate=im.copy();stats['cleanup_applied_to_candidate']=False
        warnings.append(f'{typ}: destructive global keying disabled; review before isolating individual sprites')
    name=path.stem
    candidate.save(dest/f'{name}_alpha_candidate.png',compress_level=2)
    # DP segmentation only at preview scale; for full-sized inputs downscale overlay to avoid extreme time.
    overlay_input=candidate.copy();overlay_input.thumbnail((1100,1100),Image.Resampling.BOX)
    arr=np.asarray(overlay_input.convert('RGBA'))
    alpha=arr[:,:,3]
    parts,lab=component_objects(alpha,min_area=20)
    # For mostly solid composites, skip meaningless components and seam path.
    if len(parts) and parts[0]['area']>alpha.size*.55:
        warnings.append('Full-bleed image/merged panels dominate component mask; no safe sprite segmentation')
    contours=outer_contours((alpha>105),min_area=20)
    seam=dp_min_energy_vertical(arr[:,:,:3],alpha)
    pivots=feet_pivot_candidates(parts,lab)
    overlay=render_overlay(overlay_input,parts,contours,seam,pivots)
    overlay.save(dest/f'{name}_seam_contour_pivot_overlay.png',compress_level=2)
    q,hm,de=quantize_neutral_lab(candidate,down=512)
    q.save(dest/f'{name}_quantization_preview.png',compress_level=2)
    hm.save(dest/f'{name}_delta_e00_heatmap.png',compress_level=2)
    stats['quantization']=de
    stats['segmentation']={'8_connected_components_above_min_area':len(parts),
         'top20_component_boxes':[x['bbox'] for x in parts[:20]],
         'dp_seam_vertical_sample_coordinates':seam[::max(1,len(seam)//80)],
         'ordered_outer_contour_count':len(contours),'candidate_pivots':pivots,
         'exported_frame_count':0,'manual_row_region_hints_needed':True}
    # Block-uniformity at 2x2 original 4K is NOT expected after Lanczos enhancement.
    pixels=arr[:,:,:3]
    H,W=pixels.shape[:2];A=pixels[0:H//2*2:2,0:W//2*2:2]
    eq=(pixels[1:H//2*2:2,0:W//2*2:2]==A).all(axis=2)
    stats['two_by_two_nearest_neighbour_uniformity_estimate']=round(float(eq.mean()),4)
    stats['v31_animation_validation']='BLOCKED_UNTIL_FRAME_EXTRACTION_AND_TIMING_METADATA'
    stats['warnings']=warnings
    (dest/f'{name}_preflight_audit.json').write_text(json.dumps(stats,indent=2),encoding='utf8')
    print(path.name,typ,'cleaned' if stats['cleanup_applied_to_candidate'] else 'preserved','bbox',len(parts),'deltaE95',round(de['p95_delta_e00'],2),'warnings',len(warnings),flush=True)
    return stats

if __name__=='__main__':
    p=argparse.ArgumentParser()
    p.add_argument('--image',type=Path,required=True)
    p.add_argument('--dest',type=Path,required=True)
    p.add_argument('--max-long-edge',type=int,default=1024)
    p.add_argument('--full',action='store_true')
    args=p.parse_args()
    work(args.image,args.dest,args.max_long_edge,args.full)
