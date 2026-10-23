import fs from 'fs'; import { PNG } from 'pngjs'
const [,, a, b, x, y, w, h, out] = process.argv
const A = PNG.sync.read(fs.readFileSync(a)), B = PNG.sync.read(fs.readFileSync(b))
const [X,Y,W,H] = [x,y,w,h].map(Number)
const o = new PNG({ width: W*2+10, height: H })
for (const [img, ox] of [[A,0],[B,W+10]]) for (let j=0;j<H;j++) for (let i=0;i<W;i++){
  const s=((Y+j)*img.width+X+i)*4, d=(j*o.width+ox+i)*4; for(let k=0;k<4;k++) o.data[d+k]=img.data[s+k] }
fs.writeFileSync(out, PNG.sync.write(o))
