// Set styles only on nodes owned by the component. No global CSS or document
// language/locale is changed when multiple maps use different presentations.
export function styleControl(element,presentation) {
  const {theme}=presentation;
  element.setAttribute('lang',presentation.locale);element.setAttribute('dir',presentation.direction);
  if(element.style)Object.assign(element.style,{fontFamily:theme.fontFamily,color:theme.text,background:theme.panelBackground,borderColor:theme.border});
}
