/** English stop words plus academic/news boilerplate that carries no topic signal. */
export const STOPWORDS: ReadonlySet<string> = new Set([
  'a','about','above','after','again','against','all','am','an','and','any','are','aren','as','at','be','because','been','before','being','below','between','both','but','by','can','cannot','could','did','do','does','doing','don','down','during','each','few','for','from','further','had','has','have','having','he','her','here','hers','herself','him','himself','his','how','i','if','in','into','is','it','its','itself','just','me','more','most','my','myself','no','nor','not','now','of','off','on','once','only','or','other','ought','our','ours','ourselves','out','over','own','same','she','should','so','some','such','than','that','the','their','theirs','them','themselves','then','there','these','they','this','those','through','to','too','under','until','up','very','was','we','were','what','when','where','which','while','who','whom','why','will','with','would','you','your','yours','yourself','yourselves',
  // task/calendar boilerplate
  'task','todo','call','email','meeting','meet','sync','review','check','follow','followup','update','plan','discuss','prep','prepare','draft','send','read','write','finish','start','make','get','set','use','need','want','also','via','re','fyi','asap','eod','eow',
  // publishing boilerplate
  'paper','papers','study','studies','article','articles','blog','post','posts','news','report','reports','abstract','introduction','conclusion','results','using','used','based','new','novel','approach','method','methods','toward','towards','via','arxiv','doi','http','https','www','com','org','net','pdf','html',
]);

export function isStopword(term: string): boolean {
  return STOPWORDS.has(term);
}
