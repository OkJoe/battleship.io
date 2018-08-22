var o = {
	a:1, 
	b: {
		c:function() {console.log(this); }
	}
}; 
o.b.c = o.b.c.bind(o); 
setInterval(o.b.c, 1000);