#!/usr/bin/env python3
"""Normalize ONE EXTRACTED TRANSPARENT CHARACTER FRAME into a V3.1 64x64 or 128x128 atlas cell.

Not for feeding a full flattened concept sheet. Uses alpha-aware BOX downsampling,
computed foot centroid/baseline, safe boundary clamping, and nearest-neighbor integer x2 upscaling.

Run:
  python 05_TOOLS/normalize_extracted_frame_v31.py --input extracted_frame.png --type player --output prepared/player_idle_000.png

Requires Pillow and NumPy. Source must be an actual isolated character frame with alpha.
"""
from PIL import Image
import numpy as np
from pathlib import Path
import argparse,json,hashlib

def premul_resize(img,size):
    rgba=np.asarray(img.convert('RGBA'),dtype=np.float32)
    a=rgba[:,:,3:4]/255.0
    premul=np.zeros_like(rgba)
    premul[:,:,:3]=rgba[:,:,:3]*a
    premul[:,:,3:4]=rgba[:,:,3:4]
    channels=[]
    for c in range(4):
        planes=Image.fromarray(np.clip(premul[:,:,c],0,255).astype('uint8'),'L')
        channels.append(np.asarray(planes.resize(size,Image.Resampling.BOX),dtype=np.float32))
    out=np.stack(channels,axis=2)
    al=out[:,:,3:4]/255.0
    out[:,:,:3]=np.where(al>0.02,out[:,:,:3]/np.maximum(al,0.02),0)
    return Image.fromarray(np.clip(out,0,255).astype('uint8'),'RGBA')

def occupied_box(im,cutoff=30):
    a=np.asarray(im.convert('RGBA'))[:,:,3]
    ys,xs=np.nonzero(a>cutoff)
    if not len(xs):raise ValueError('Empty transparent frame')
    return [int(xs.min()),int(ys.min()),int(xs.max())+1,int(ys.max())+1]

def feet_centroid(im):
    a=np.asarray(im.convert('RGBA'))[:,:,3]
    bbox=occupied_box(im)
    x0,y0,x1,y1=bbox;row=max(y0,y1-max(2,int((y1-y0)*.2)))
    ys,xs=np.nonzero(a[row:y1,x0:x1]>65)
    if not len(xs):return ((x0+x1)*.5,y1-1)
    return (float(x0+xs.mean()),float(row+ys.max()))

def normalize(im,kind='player'):
    if kind not in ('player','tyrant'):raise ValueError('type must be player or tyrant')
    if 'A' not in im.getbands():raise ValueError('A validated RGBA isolated frame is required; do not pass a full concept board.')
    box=occupied_box(im); sprite=im.crop(tuple(box))
    # 2x native-pixel contract: 32x32 draft -> 64x64 player; 64x64 draft -> 128x128 boss.
    cell=64 if kind=='player' else 128
    native=cell//2
    pivot=(32,54) if kind=='player' else (64,104)
    px,py=pivot[0]//2,pivot[1]//2
    margin=1 if kind=='player' else 2
    max_w=native-2*margin;max_h=native-2*margin
    foot_before=feet_centroid(sprite)
    # Keep room *above* and *below* measured foot contact so the target pivot
    # remains reachable without clipping or scaling an oversized robe off-canvas.
    room_above=max(1,py-margin)
    room_below=max(1,native-margin-1-py)
    foot_above=max(1,foot_before[1])
    foot_below=max(1,sprite.height-1-foot_before[1])
    scale=min(1,max_w/sprite.width,max_h/sprite.height,room_above/foot_above,room_below/foot_below)
    size=(max(1,round(sprite.width*scale)),max(1,round(sprite.height*scale)))
    if size!=sprite.size:sprite=premul_resize(sprite,size)
    fx,fy=feet_centroid(sprite)
    offset_x=round(px-fx);offset_y=round(py-fy)
    clamp_x=min(max(0,offset_x), native-sprite.width)
    clamp_y=min(max(0,offset_y), native-sprite.height)
    clamped=(clamp_x!=offset_x or clamp_y!=offset_y)
    canvas=Image.new('RGBA',(native,native),(0,0,0,0))
    canvas.alpha_composite(sprite,(clamp_x,clamp_y))
    high=canvas.resize((cell,cell),Image.Resampling.NEAREST)
    feet=feet_centroid(high)
    rgba=np.asarray(high)
    corners=np.array([rgba[0,0,3],rgba[-1,0,3],rgba[0,-1,3],rgba[-1,-1,3]])
    b=occupied_box(high)
    # meaningful silhouette perimeter coverage, measured in a two-pixel inside edge band.
    alpha=rgba[:,:,3]>65
    from scipy.ndimage import binary_erosion
    perimeter=alpha & (~binary_erosion(alpha,iterations=2))
    RGB=rgba[:,:,:3].astype('int32')
    ink=np.array([20,14,29],dtype='int32')
    ink_on_perimeter=float(np.mean((np.max(abs(RGB[perimeter]-ink),axis=1)<35))) if perimeter.any() else None
    metrics={
        'type':kind,'cell_dimensions':[cell,cell],'draft_native_dimensions':[native,native],
        'target_pivot':list(pivot),'detected_feet_centroid':[round(feet[0],2),round(feet[1],2)],
        'pivot_deviation_px':round(float(((feet[0]-pivot[0])**2+(feet[1]-pivot[1])**2)**.5),3),
        'pivot_safe_clamping_applied':clamped,'sprite_bbox':b,
        'corner_alpha_values':corners.tolist(),
        'two_by_two_pixel_uniformity':float(np.mean(np.all((rgba[::2,::2]==rgba[1::2,::2])& (rgba[::2,::2]==rgba[::2,1::2])&(rgba[::2,::2]==rgba[1::2,1::2]),axis=2))),
        'perimeter_ink_fraction_approx':ink_on_perimeter,
        'hurtbox_containment':'NOT_TESTED_REQUIRES_AUTHORED_HURTBOX',
        'hitbox_overflow':'NOT_TESTED_REQUIRES_ATTACK_METADATA',
        'animation_temporal_jitter':'NOT_TESTED_REQUIRES_ANIMATION_SEQUENCE',
        'status':'REQUIRES_MANUAL_VISUAL_APPROVAL',
    }
    return high,metrics

if __name__=='__main__':
    ap=argparse.ArgumentParser()
    ap.add_argument('--input',type=Path,required=True)
    ap.add_argument('--output',type=Path,required=True)
    ap.add_argument('--type',choices=('player','tyrant'),default='player')
    a=ap.parse_args()
    image=Image.open(a.input)
    normalized,metrics=normalize(image,a.type)
    a.output.parent.mkdir(parents=True,exist_ok=True)
    normalized.save(a.output,'PNG')
    (a.output.parent/(a.output.stem+'_audit.json')).write_text(json.dumps(metrics,indent=2),encoding='utf-8')
    print(json.dumps(metrics,indent=2))
