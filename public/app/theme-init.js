// Apply the last saved palette before CSS and the first page paint.
(() => {
 let palette='paper';try{const value=localStorage.getItem('independent-palette');if(['paper','sage','mist','ivory'].includes(value))palette=value;}catch{}
 document.documentElement.dataset.palette=palette;
 document.querySelector('meta[name="theme-color"]')?.setAttribute('content',['mist','ivory'].includes(palette)?'#f3eee4':palette==='paper'?'#f3eee4':'#f7f8f4');
})();
