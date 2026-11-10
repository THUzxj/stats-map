import { StatsMapError } from './errors.js';

const english = {
  routeTotal:'Displayed route total',displayed:'Displayed',excluded:'Excluded',
  regionList:'Regions and original values',noBoundary:'No boundary',noAnchor:'No symbol anchor',legend:'Legend', indicator:'Indicator {index}', color:'Color', opacity:'Opacity', missing:'No data', zero:'Total is zero', conflict:'Components conflict with total',
  other:'Other', remainder:'Unshown remainder', flow:'Flow', beforeFilter:'Before filtering', afterFilter:'After filtering', crossBoundary:'Between regions', internal:'Internal',
  sharedAxis:'Shared vertical axis', localAxis:'Separate vertical axes', timeSpacing:'Actual time intervals', orderedSpacing:'Declared period order',
  area:'Area', height:'Height', radius:'Radius', radar:'Radar', absoluteScale:'Absolute values, shared scale', share:'Share within symbol',
  commonHeight:'Shared height scale', commonWidth:'Shared width scale', symbolArea:'Symbol area', totalMaximum:'Total / maximum', approximate:'Cells are rounded approximations; tooltips retain original values',
  ranking:'Region ranking', categoryRanking:'Categories have no numeric ranking.', rankingMissing:'Missing', hiddenRanking:'Other numeric regions',
  previous:'Previous', next:'Next', previousPeriod:'Previous period', nextPeriod:'Next period', playPause:'Play / pause', time:'Time', chapter:'Chapter', pages:'Comparison pages',
  coverage:'Coverage', source:'Source', map:'Statistics map', scaleAt:'Approximate scale at {latitude}° latitude', physicalScale:'Physical coordinate scale',
  value:'Value', incoming:'Incoming',outgoing:'Outgoing',not_available:'Not available', not_applicable:'Not applicable', suppressed:'Suppressed', out_of_scope:'Outside scope',
};
const messages = {
  en:english,
  zh:{routeTotal:'显示路线合计',displayed:'已显示',excluded:'未显示',regionList:'地区与原始数值',noBoundary:'无边界',noAnchor:'无符号锚点',incoming:'流入',outgoing:'流出',legend:'图例',indicator:'指标 {index}',color:'颜色',opacity:'透明度',missing:'无数据',zero:'总和为零',conflict:'分量与总量冲突',other:'其他',remainder:'未显示的剩余分量',flow:'流量',beforeFilter:'筛选前',afterFilter:'筛选后',crossBoundary:'跨地区',internal:'内部',sharedAxis:'共同纵轴',localAxis:'各地区独立纵轴',timeSpacing:'按实际时间间隔',orderedSpacing:'按声明期次顺序',area:'面积',height:'高度',radius:'半径',radar:'雷达',absoluteScale:'绝对值，共同尺度',share:'符号内份额',commonHeight:'共同高度量尺',commonWidth:'共同柱宽量尺',symbolArea:'符号面积',totalMaximum:'总量 / 最大',approximate:'格子为取整近似；提示保留原值',ranking:'地区排名',categoryRanking:'分类数据不适用数值排名。',rankingMissing:'缺失',hiddenRanking:'其他数值地区',previous:'上一项',next:'下一项',previousPeriod:'上一期',nextPeriod:'下一期',playPause:'播放 / 暂停',time:'时间',chapter:'章节',pages:'比较分页',coverage:'覆盖',source:'来源',map:'统计地图',scaleAt:'纬度 {latitude}° 处的近似比例尺',physicalScale:'物理坐标比例尺',value:'数值',not_available:'未公开',not_applicable:'不适用',suppressed:'保密',out_of_scope:'未纳入范围'},
  fr:{routeTotal:'Total de la liaison affichée',displayed:'Affiché',excluded:'Exclu',regionList:'Régions et valeurs originales',noBoundary:'Aucune limite',noAnchor:'Aucun point d’ancrage',incoming:'Entrant',outgoing:'Sortant',legend:'Légende',indicator:'Indicateur {index}',color:'Couleur',opacity:'Opacité',missing:'Aucune donnée',zero:'Total nul',conflict:'Composantes incompatibles avec le total',other:'Autres',remainder:'Reste non affiché',flow:'Flux',beforeFilter:'Avant filtrage',afterFilter:'Après filtrage',crossBoundary:'Entre régions',internal:'Interne',sharedAxis:'Axe vertical commun',localAxis:'Axes verticaux distincts',timeSpacing:'Intervalles de temps réels',orderedSpacing:'Ordre déclaré des périodes',area:'Surface',height:'Hauteur',radius:'Rayon',radar:'Radar',absoluteScale:'Valeurs absolues, échelle commune',share:'Part dans le symbole',commonHeight:'Échelle commune des hauteurs',commonWidth:'Échelle commune des largeurs',symbolArea:'Surface du symbole',totalMaximum:'Total / maximum',approximate:'Cellules arrondies ; les infobulles conservent les valeurs originales',ranking:'Classement des régions',categoryRanking:'Les catégories ne permettent pas de classement numérique.',rankingMissing:'Données manquantes',hiddenRanking:'Autres régions numériques',previous:'Précédent',next:'Suivant',previousPeriod:'Période précédente',nextPeriod:'Période suivante',playPause:'Lecture / pause',time:'Temps',chapter:'Chapitre',pages:'Pages de comparaison',coverage:'Couverture',source:'Source',map:'Carte statistique',scaleAt:'Échelle approximative à la latitude {latitude}°',physicalScale:'Échelle des coordonnées physiques',value:'Valeur',not_available:'Non disponible',not_applicable:'Sans objet',suppressed:'Confidentiel',out_of_scope:'Hors champ'},
  de:{routeTotal:'Angezeigte Routensumme',displayed:'Angezeigt',excluded:'Ausgeschlossen',regionList:'Regionen und Originalwerte',noBoundary:'Keine Grenze',noAnchor:'Kein Symbolanker',incoming:'Zufluss',outgoing:'Abfluss',legend:'Legende',indicator:'Indikator {index}',color:'Farbe',opacity:'Deckkraft',missing:'Keine Daten',zero:'Summe ist null',conflict:'Komponenten stimmen nicht mit der Summe überein',other:'Sonstige',remainder:'Nicht dargestellter Rest',flow:'Strom',beforeFilter:'Vor Filterung',afterFilter:'Nach Filterung',crossBoundary:'Zwischen Regionen',internal:'Intern',sharedAxis:'Gemeinsame vertikale Achse',localAxis:'Separate vertikale Achsen',timeSpacing:'Tatsächliche Zeitabstände',orderedSpacing:'Angegebene Periodenreihenfolge',area:'Fläche',height:'Höhe',radius:'Radius',radar:'Radar',absoluteScale:'Absolute Werte, gemeinsame Skala',share:'Anteil im Symbol',commonHeight:'Gemeinsame Höhenskala',commonWidth:'Gemeinsame Breitenskala',symbolArea:'Symbolfläche',totalMaximum:'Summe / Maximum',approximate:'Zellen sind gerundete Näherungen; Tooltips zeigen Originalwerte',ranking:'Rangliste der Regionen',categoryRanking:'Kategorien haben keine numerische Rangfolge.',rankingMissing:'Fehlend',hiddenRanking:'Weitere numerische Regionen',previous:'Zurück',next:'Weiter',previousPeriod:'Vorherige Periode',nextPeriod:'Nächste Periode',playPause:'Wiedergabe / Pause',time:'Zeit',chapter:'Kapitel',pages:'Vergleichsseiten',coverage:'Abdeckung',source:'Quelle',map:'Statistische Karte',scaleAt:'Ungefährer Maßstab bei {latitude}° Breite',physicalScale:'Maßstab der physischen Koordinaten',value:'Wert',not_available:'Nicht verfügbar',not_applicable:'Nicht zutreffend',suppressed:'Geheim',out_of_scope:'Außerhalb des Bereichs'},
};
const detailMessages = {
  en:{unit:'Unit',timeWindow:'Time window',startPeriod:'Start period',endPeriod:'End period',resetWindow:'Show all periods',scope:'Scope',measureType:'Measure type',reviewStatus:'Review status',actual:'Actual',estimate:'Estimate',target:'Target',unspecified:'Unspecified',reviewed:'Reviewed',unreviewed:'Unreviewed',partial:'Partial',numerator:'Numerator',denominator:'Denominator',sourceFlag:'Source flag',evidence:'Evidence',dataset:'Dataset'},
  zh:{unit:'单位',timeWindow:'时间范围',startPeriod:'起始期',endPeriod:'结束期',resetWindow:'显示全部期次',scope:'统计范围',measureType:'数值性质',reviewStatus:'复核状态',actual:'实绩',estimate:'预计',target:'目标',unspecified:'未注明',reviewed:'已复核',unreviewed:'未复核',partial:'部分覆盖',numerator:'分子',denominator:'分母',sourceFlag:'原始标记',evidence:'证据',dataset:'数据集'},
  fr:{unit:'Unité',timeWindow:'Plage temporelle',startPeriod:'Période initiale',endPeriod:'Période finale',resetWindow:'Toutes les périodes',scope:'Champ',measureType:'Type de mesure',reviewStatus:'État de révision',actual:'Réalisé',estimate:'Estimation',target:'Objectif',unspecified:'Non précisé',reviewed:'Révisé',unreviewed:'Non révisé',partial:'Partiel',numerator:'Numérateur',denominator:'Dénominateur',sourceFlag:'Indicateur source',evidence:'Preuve',dataset:'Jeu de données'},
  de:{unit:'Einheit',timeWindow:'Zeitfenster',startPeriod:'Anfangsperiode',endPeriod:'Endperiode',resetWindow:'Alle Perioden',scope:'Geltungsbereich',measureType:'Messart',reviewStatus:'Prüfstatus',actual:'Istwert',estimate:'Schätzung',target:'Zielwert',unspecified:'Nicht angegeben',reviewed:'Geprüft',unreviewed:'Ungeprüft',partial:'Teilweise',numerator:'Zähler',denominator:'Nenner',sourceFlag:'Quellkennzeichen',evidence:'Beleg',dataset:'Datensatz'},
};
const rankingMessages={en:{rankingDistribution:'Distribution of original region values',rankingRegions:'regions',rankingBars:'Show individual rankings',rankingHistogram:'Show distribution'},zh:{rankingDistribution:'地区原始数值分布',rankingRegions:'个地区',rankingBars:'显示逐地区排名',rankingHistogram:'显示数值分布'},fr:{rankingDistribution:'Distribution des valeurs originales des régions',rankingRegions:'régions',rankingBars:'Afficher les classements individuels',rankingHistogram:'Afficher la distribution'},de:{rankingDistribution:'Verteilung der ursprünglichen Regionswerte',rankingRegions:'Regionen',rankingBars:'Einzelne Rangfolge anzeigen',rankingHistogram:'Verteilung anzeigen'}};
for(const [locale,entries] of Object.entries(rankingMessages))Object.assign(detailMessages[locale],entries);
const flowMessages={
  en:{netExporter:'Net exporter',netImporter:'Net importer',mixedFlow:'Mixed route categories',flowNodeSize:'Incoming + outgoing + internal'},
  zh:{netExporter:'净流出地区',netImporter:'净流入地区',mixedFlow:'混合路线类别',flowNodeSize:'流入 + 流出 + 内部'},
  fr:{netExporter:'Exportateur net',netImporter:'Importateur net',mixedFlow:'Catégories de route mixtes',flowNodeSize:'Entrées + sorties + interne'},
  de:{netExporter:'Nettoexporteur',netImporter:'Nettoimporteur',mixedFlow:'Gemischte Routenkategorien',flowNodeSize:'Zufluss + Abfluss + intern'},
};
for(const [locale,entries] of Object.entries(flowMessages))Object.assign(detailMessages[locale],entries);
const symbolMessages={en:'Minimum size for positive values',zh:'正值的最小显示尺寸',fr:'Taille minimale des valeurs positives',de:'Mindestgröße für positive Werte'};
for(const [locale,label] of Object.entries(symbolMessages))detailMessages[locale].minimumSymbolSize=label;
for(const [locale,label] of Object.entries({en:'Size',zh:'大小',fr:'Taille',de:'Größe'}))detailMessages[locale].size=label;
const compositionMessages={
  en:{nominalSize:'Nominal total size',compositionSizeReference:'Equal-share size references; component shares and values determine the filled geometry.'},
  zh:{nominalSize:'总量的名义尺寸',compositionSizeReference:'等份尺寸参照；分量份额和数值决定实际填充形状。'},
  fr:{nominalSize:'Taille nominale du total',compositionSizeReference:'Repères de taille à parts égales ; les parts et valeurs déterminent la géométrie remplie.'},
  de:{nominalSize:'Nominale Gesamtgröße',compositionSizeReference:'Größenreferenzen mit gleichen Anteilen; Anteile und Werte bestimmen die gefüllte Geometrie.'}
};
for(const [locale,entries] of Object.entries(compositionMessages))Object.assign(detailMessages[locale],entries);
for(const [locale,entries] of Object.entries(detailMessages))Object.assign(messages[locale],entries);
const light = {background:'#ffffff',text:'#1f2937',mutedText:'#64748b',border:'#94a3b8',regionStroke:'#555555',noData:'#e5e7eb',zero:'#ffffff',conflict:'#fee2e2',selection:'#111827',hover:'#2563eb',panelBackground:'#f1f5f9',selectedBackground:'#dbeafe',hoverBackground:'#eff6ff',accent:'#2563eb',fontFamily:'sans-serif'};
const themes = {
  light,
  dark:{...light,background:'#111827',text:'#f3f4f6',mutedText:'#cbd5e1',border:'#64748b',regionStroke:'#cbd5e1',noData:'#374151',zero:'#111827',conflict:'#7f1d1d',selection:'#facc15',hover:'#67e8f9',panelBackground:'#1f2937',selectedBackground:'#1e3a8a',hoverBackground:'#164e63',accent:'#60a5fa'},
  'high-contrast':{...light,background:'#000000',text:'#ffffff',mutedText:'#ffffff',border:'#ffffff',regionStroke:'#ffffff',noData:'#333333',zero:'#000000',conflict:'#ff0000',selection:'#ffff00',hover:'#00ffff',panelBackground:'#000000',selectedBackground:'#333333',hoverBackground:'#333333',accent:'#00ffff'},
};
const paletteKeys=['numericColors','categoryColors','compositionColors','bivariateColors'];
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
export function localizedLabel(resource,locale,fallback='') {
  if(resource==null)return fallback;if(typeof resource==='string')return resource;
  const variants=resource.labels??resource.titles,language=locale?.split('-')[0];
  return variants?.[locale]??variants?.[language]??resource.label??resource.title??fallback;
}
export function resolveTheme(input='light') {
  if(typeof input!=='string'&&!object(input))throw new StatsMapError('theme must be a name or token object','INVALID_THEME');
  const name=typeof input==='string'?input:input.base??'light';
  if(!themes[name])throw new StatsMapError(`unknown theme: ${name}`,'INVALID_THEME');
  const theme={...themes[name],...(typeof input==='string'?{}:input),base:name};
  for(const [key,value] of Object.entries(theme)){
    if(key==='base')continue;
    if(key==='fontFamily'){if(typeof value!=='string'||!value||/[<>;{}]/.test(value))throw new StatsMapError('invalid theme font family','INVALID_THEME');continue;}
    if(paletteKeys.includes(key)){
      if(!Array.isArray(value)||!value.length||value.some(color=>!/^#[0-9a-f]{6}$/i.test(color))||key==='bivariateColors'&&value.length!==9)throw new StatsMapError(`invalid theme palette: ${key}`,'INVALID_THEME');
    }else if(!(key in light)||typeof value!=='string'||!/^#[0-9a-f]{6}$/i.test(value))throw new StatsMapError(`invalid theme token: ${key}`,'INVALID_THEME');
  }
  return theme;
}
export function createPresentation(spec={},geography={}) {
  let locale;
  try{const requested=spec.view?.locale??spec.locale??geography.default_locale??new Intl.NumberFormat().resolvedOptions().locale;if(typeof requested!=='string')throw new Error();locale=Intl.getCanonicalLocales(requested)[0];if(!locale)throw new Error();}
  catch{throw new StatsMapError('locale must be a valid BCP 47 language tag','INVALID_LOCALE');}
  const language=locale.split('-')[0],custom=spec.messages??{};
  if(!object(custom)||Object.values(custom).some(value=>typeof value!=='string'))throw new StatsMapError('messages must contain plain text strings','INVALID_LOCALE');
  if(spec.number_format!=null&&!object(spec.number_format))throw new StatsMapError('number_format must be an Intl.NumberFormat options object','INVALID_LOCALE');
  const catalog={...english,...flowMessages.en,...messages[language],...custom};
  const formatOptions=override=>{const configured={...spec.number_format,...override};return {maximumSignificantDigits:configured.minimumFractionDigits!=null||configured.maximumFractionDigits!=null?undefined:6,...configured};};
  let formatter;
  try{formatter=new Intl.NumberFormat(locale,formatOptions());}
  catch{throw new StatsMapError('invalid number_format options','INVALID_LOCALE');}
  const label=(resource,fallback='')=>localizedLabel(resource,locale,fallback);
  const number=(value,options)=>{
    if(!Number.isFinite(value))return String(value??'');
    try{return options?new Intl.NumberFormat(locale,formatOptions(options)).format(value):formatter.format(value);}
    catch{throw new StatsMapError('invalid number formatting options','INVALID_LOCALE');}
  };
  return {locale,language,direction:/^(ar|fa|he|ur)(-|$)/i.test(locale)?'rtl':'ltr',theme:resolveTheme(spec.theme),messages:catalog,label,number,
    t:(key,parameters={})=>String(catalog[key]??key).replace(/\{([^{}]+)\}/g,(match,name)=>parameters[name]==null?match:String(parameters[name]))};
}

// Defaults are applied for drawing, without replacing the user's declaration.
export function presentedLayer(layer,presentation) {
  const {theme,t}=presentation,type=layer.type;
  const composition=['stripeComposition','stripe','pieChart','pie','coxcomb','waffle','bar'].includes(type);
  const options={noDataColor:theme.noData,zeroColor:theme.zero,conflictColor:theme.conflict,stroke:theme.regionStroke,otherLabel:t('other'),remainderLabel:t('remainder'),...layer.options,locale:presentation.locale};
  const colors=composition?theme.compositionColors:type==='categorical'?theme.categoryColors:['choropleth','ch','alpha'].includes(type)?theme.numericColors:null;
  if(colors&&options.colors==null)options.colors=colors;
  if(theme.bivariateColors&&options.bivariateColors==null)options.bivariateColors=theme.bivariateColors;
  if(['proportionalSymbol','ps','mushroom'].includes(type)&&options.fill==null)options.fill=theme.accent;
  if(type==='mushroom'&&theme.compositionColors&&options.colors==null)options.colors=theme.compositionColors;
  if(type==='flow'){options.color??=theme.accent;options.endColor??=theme.hover;options.messages=presentation.messages;options.theme=theme;}
  if(options.texture)options.texture={color:theme.text,background:theme.background,...(typeof options.texture==='string'?{type:options.texture}:options.texture)};
  return {...layer,options,presentation};
}
