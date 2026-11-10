import { dorlingLayout } from './dorling.js';
if (typeof self !== 'undefined' && self.postMessage) self.onmessage = event => {
  const {requestId,nodes,options}=event.data;
  try { self.postMessage({requestId,nodes:dorlingLayout(nodes,options),status:'done'}); }
  catch (error) { self.postMessage({requestId,status:'failed',error:String(error?.message??error)}); }
};
