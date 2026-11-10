import { StatsMapError } from '../core/errors.js';

export async function svgPngBlob(svg,width,height,options={}) {
  if(typeof document==='undefined'&&typeof OffscreenCanvas==='undefined')throw new StatsMapError('PNG export requires a browser canvas adapter','EXPORT_UNAVAILABLE');
  const blob=new Blob([svg],{type:'image/svg+xml;charset=utf-8'});
  let image,url;
  try {
    // Some browsers support ImageBitmap, but cannot decode an SVG Blob with it.
    if(typeof createImageBitmap==='function')try { image=await createImageBitmap(blob); } catch { /* Try the SVG Image decoder below. */ }
    if(!image){
      if(typeof Image==='undefined')throw new StatsMapError('SVG image decoding is unavailable','EXPORT_UNAVAILABLE');
      url=URL.createObjectURL(blob);
      image=new Image();
      await new Promise((resolve,reject)=>{
        image.onload=resolve;
        image.onerror=()=>reject(new StatsMapError('SVG could not be rasterized','EXPORT_FAILED'));
        image.src=url;
      });
    }
    const canvas=typeof OffscreenCanvas!=='undefined'?new OffscreenCanvas(width,height):document.createElement('canvas');
    canvas.width=width;canvas.height=height;
    const context=canvas.getContext('2d');
    if(!context)throw new StatsMapError('2D canvas is unavailable','EXPORT_UNAVAILABLE');
    if(options.background){context.fillStyle=options.background;context.fillRect(0,0,width,height);}
    context.drawImage(image,0,0,width,height);
    const result=canvas.convertToBlob?await canvas.convertToBlob({type:'image/png'}):await new Promise((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new StatsMapError('PNG encoding failed','EXPORT_FAILED')),'image/png'));
    if(!result)throw new StatsMapError('PNG encoding failed','EXPORT_FAILED');
    return result;
  } finally {
    image?.close?.();
    if(image&&'onload' in image){image.onload=null;image.onerror=null;}
    if(url)URL.revokeObjectURL(url);
  }
}
