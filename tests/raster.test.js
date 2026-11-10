import test from 'node:test';
import assert from 'node:assert/strict';
import { svgPngBlob } from '../src/components/raster.js';

test('PNG export falls back from ImageBitmap to Image and revokes URLs on success and failure',async()=>{
  const old={canvas:globalThis.OffscreenCanvas,bitmap:globalThis.createImageBitmap,image:globalThis.Image,create:URL.createObjectURL,revoke:URL.revokeObjectURL};
  let fail=false,created=0,revoked=0,drawn=0,decoded;
  globalThis.createImageBitmap=async()=>{throw new Error('SVG ImageBitmap decoding unavailable');};
  URL.createObjectURL=()=>`blob:test-${++created}`;
  URL.revokeObjectURL=()=>revoked++;
  globalThis.Image=class {set src(value){decoded=this;queueMicrotask(()=>fail?this.onerror():this.onload());}};
  globalThis.OffscreenCanvas=class {getContext(){return {drawImage(){drawn++;}};}async convertToBlob(){return new Blob(['encoded'],{type:'image/png'});}};
  try {
    const png=await svgPngBlob('<svg/>',20,10);
    assert.equal(png.type,'image/png');
    assert.equal(drawn,1);
    assert.equal(created,1);assert.equal(revoked,1);
    assert.equal(decoded.onload,null);assert.equal(decoded.onerror,null);
    fail=true;
    await assert.rejects(svgPngBlob('<svg/>',20,10),error=>error.code==='EXPORT_FAILED');
    assert.equal(created,2);assert.equal(revoked,2);
    assert.equal(decoded.onload,null);assert.equal(decoded.onerror,null);
  } finally {
    globalThis.OffscreenCanvas=old.canvas;globalThis.createImageBitmap=old.bitmap;globalThis.Image=old.image;URL.createObjectURL=old.create;URL.revokeObjectURL=old.revoke;
  }
});
