var Lispy = require('./lispy');

for(var key in Lispy)
	exports[key] = Lispy[key];

// If not required as a module, invoke Main
if (typeof module !== 'undefined' && !module.parent)
	Lispy.Main();
