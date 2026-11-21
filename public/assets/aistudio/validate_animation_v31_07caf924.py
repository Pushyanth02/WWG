#!/usr/bin/env python3
"""Validate real, individually extracted PNG frames under a V3.1 character contract.

Usage: python 05_TOOLS/validate_animation_v31.py --frames extracted/player_idle/*.png --type player --fps 8
A sheet with baked captions and proposed frames CANNOT be passed as a completed animation.
"""
from pathlib import Path
from PIL import Image
import numpy as np,hashlib,sys,argparse,json,glob

def feet(im):
 a=np.asarray(im.convert('RGBA'))[:,:,3]
 ys,xs=np.nonzero(a>65)
 if not len(xs):return None
 bot=ys.max();ix=(ys>=bot-max(3,int(im.height*.2)))
 return [float(np.mean(xs[ix])),float(bot)]

if __name__=='__main__':
 p=argparse.ArgumentParser()
 p.add_argument('--frames',nargs='+',required=True)
 p.add_argument('--type',choices=('player','tyrant'),default='player')
 p.add_argument('--fps',type=float,default=8)
 p.add_argument('--expected-count',type=int)
 p.add_argument('--output',type=Path)
 a=p.parse_args()
 paths=sorted({str(x) for pattern in a.frames for x in glob.glob(pattern)})
 if not paths:raise SystemExit('ERROR: no extracted PNG frames found. No pass possible.')
 target=64 if a.type=='player' else 128
 goal=[32,54] if a.type=='player' else [64,104]
 errs=[];frames=[];hashes=[];feet_series=[]
 for path in paths:
  im=Image.open(path).convert('RGBA')
  if im.size!=(target,target):errs.append(f'{path}: wrong dimensions {im.size}')
  r=np.asarray(im)
  hashval=hashlib.sha256(im.tobytes()).hexdigest();hashes.append(hashval)
  fp=feet(im);feet_series.append(fp)
  frames.append({'file':path,'size':list(im.size),'sha256_pixels':hashval,'feet_centroid':fp,
                 'uniform_texel_2x2':float(np.mean(np.all((r[::2,::2]==r[1::2,::2])&(r[::2,::2]==r[::2,1::2])&(r[::2,::2]==r[1::2,1::2]),axis=2))) if target%2==0 else None})
 if a.expected_count and len(frames)!=a.expected_count:errs.append(f'frame_count {len(frames)} != expected {a.expected_count}')
 duplicates=[i for i in range(1,len(hashes)) if hashes[i]==hashes[i-1]]
 if duplicates:errs.append(f'adjacent duplicate frame pairs at indices {duplicates}')
 pts=[x for x in feet_series if x]
 jitter=float(np.max(np.linalg.norm(np.diff(pts,axis=0),axis=1))) if len(pts)>1 else None
 if jitter is not None and jitter>4:errs.append(f'feet pivot jitter {jitter:.2f}px > 4')
 meanUniform=float(np.mean([e['uniform_texel_2x2'] for e in frames]))
 if meanUniform<.98:errs.append(f'2x2 texel uniformity {meanUniform:.3f} below 0.98')
 result={'status':'PASS_PRELIMINARY' if not errs else 'FAIL','frame_count':len(frames),'fps':a.fps,'type':a.type,
  'feet_pivot_target':goal,'max_feet_jitter_px':jitter,'mean_2x2_uniformity':meanUniform,
  'adjacent_duplicate_indices':duplicates,'errors':errs,'frames':frames,
  'not_evaluated':['hurtbox/hitbox fit absent authoring metadata','CIEDE00 before/after color references absent','enemy/boss timing parity absent per-attack metadata']}
 if a.output:
  a.output.parent.mkdir(parents=True,exist_ok=True);a.output.write_text(json.dumps(result,indent=2),encoding='utf8')
 print(json.dumps(result,indent=2))
 if errs:sys.exit(1)
