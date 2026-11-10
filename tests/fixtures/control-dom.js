// Minimal owned-control DOM, intentionally no SVG parser or global document.
// Native browser behavior is checked separately in the audit probe.
export function controlDocument(){
  const document={activeElement:null,createElement(tag){
    return {tagName:tag.toUpperCase(),ownerDocument:document,attributes:new Map(),listeners:new Map(),children:[],style:{},innerHTML:'',
      setAttribute(name,value){this.attributes.set(name,String(value));},getAttribute(name){return this.attributes.get(name)??null;},
      addEventListener(name,fn){const handlers=this.listeners.get(name)??new Set();handlers.add(fn);this.listeners.set(name,handlers);},
      removeEventListener(name,fn){this.listeners.get(name)?.delete(fn);},
      fire(name){for(const fn of [...(this.listeners.get(name)??[])])fn({target:this});},
      appendChild(child){this.children.push(child);return child;},replaceChildren(...children){this.children=children;},
      contains(element){return element===this||this.children.some(child=>child.contains(element));},
      querySelectorAll(selector){const name=selector.match(/^\[([^\]]+)\]$/)?.[1],result=[];for(const child of this.children){if(name&&child.attributes.has(name))result.push(child);result.push(...child.querySelectorAll(selector));}return result;},
      focus(){document.activeElement=this;}
    };
  }};return document;
}
