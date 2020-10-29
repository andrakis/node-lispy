#!/usr/bin/env node
/**
 * Lispy.js
 *  A port of Lis.py to Node.js
 *
 * It is tail recursive, and uses only a few small custom types. Most
 * of the engine uses native JavaScript types.
 *
 * Very little error checking is done.
 * If it crashes, check the mistake is not in your code.
 *
 * Custom types:
 *
 *  Symbol        A Lisp symbol
 *  Environment   Lisp environment with parent support
 *  Lambda        A Lisp lambda, with arguments, body, and pointer to environment
 *  Macro         As above
 *  Tuple         Like an Array/List but cannot be easily manipulated after creation
 */

"use strict";

var fs = require('fs');

var debugMode = false;
var testMode  = false;
var helpMode  = false;
var programFile      = undefined;
var programArguments = [];
(function() {
	if (!process) return;
	var argv = process.argv;
	var args = true; // whether accepting Lispy arguments or not
	if(argv.length > 2) {
		for(var i = 2; i < argv.length; ++i) {
			var v = argv[i];
			if(args && v === "--")
				args = false;
			else if(args && v === "-d")
				debugMode = true;
			else if(args && v === "-T")
				testMode = true;
			else if(args && v.match(/^--?h(elp)?$/))
				helpMode = true;
			else if(programFile === undefined)
				programFile = v;
			else
				programArguments.push(v);
		}
	}
})();

var startOf = str => str.length ? str[0] : '';
var endOf   = str => str.length ? str[str.length - 1] : '';
var isspace = c => c === ' ' || c === '\t' || c === '\r' || c === '\n';
var ascii0  = '0'.charCodeAt(0);
var ascii9  = '9'.charCodeAt(0);
var isdigit = c =>
	(c === '') ? false :
		(typeof c === 'string') ? isdigit(c.charCodeAt(0)) :
			(c >= ascii0 && c <= ascii9);

var Lispy = (function() {
	function Symbol (name) { this.symbol = name; }
	function Parse (code) {
		return read_from(tokenise(code));
	}
	function tokenise(str) {
		var tokens = [];
		var s = 0, t; // string counters, use s for most and t when required
		while(s < str.length) {
			while (isspace(str[s]))                    // Skip whitespace
				++s;
			if (str.substr(s, 2) === ';;')             // Skip comment lines
				while(s < str.length && str[s] !== '\n' && str[s] !== '\r')
					++s;
			else if (str[s] === '(' || str[s] === ')') // List open or close
				tokens.push(str[s++] === '(' ? '(' : ')');
			else if (str[s] === '"') {                 // "string" in quotes
				t = s;
				var escape = 0;
				do {
					++t;
					if (escape !== 0) escape--;
					if (str[t] === '\\') escape = 2;
				} while (t < str.length && (escape !== 0 || str[t] !== '"'));
				++t;
				tokens.push(str.substr(s, t - s));
				s = t;
			} else {                                   // A generic token
				t = s;
				while (t < str.length && !isspace(str[t]) && str[t] !== '(' && str[t] !== ')')
					++t;
				tokens.push(str.substr(s, t - s));
				s = t;
			}
		}
		return tokens;
	}
	function atom (token) {
		if (startOf(token) === '"' && endOf(token) === '"')
			return token.substr(1, token.length - 2);
		if (isdigit(token[0]) || token.length > 1 && token[0] === '-' && isdigit(token[1])) {
			// coerce token to a number by calling Number class
			return Number(token);
		}
		return new Symbol(token);
	}
	function read_from(tokens) {
		if (tokens.length === 0) throw new errors.ParserError("Missing opening token");

		var token = tokens.shift();
		if (token === "(") {
			var cells = [];
			while (tokens[0] !== ")") {
				cells.push(read_from(tokens));
				if (tokens.length === 0) throw "Missing closing )";
			}
			if (tokens.length === 0) throw "Missing closing )";
			tokens.shift(); // discard closing )
			return cells;
		} else if (token === "'") {
			// '(1 2 3) => (quote (1 2 3))
			var cell = [];
			cell.push("quote"); // XXX: or, new Symbol('quote')
			cell.push(read_from(tokens));
			return cell;
		} else if (startOf(token) === "'") {
			// 'a => (quote a)
			tokens.unshift(token.substr(1));
			var cell = [];
			cell.push("quote"); // XXX: see above
			cell.push(read_from(tokens));
			return cell;
		} else {
			return atom(token);
		}
	}
	function Environment (parent) {
		this.members = {};
		this.parent  = parent;
	}
	Environment.prototype.present = function(key) {
		if(key.constructor === Symbol)
			key = key.symbol;
		if(this.members.hasOwnProperty(key))
			return true;
		if(this.parent !== undefined)
			return this.parent.present(key);
		return false;
	};
	Environment.prototype.get = function(key) {
		if(key.constructor === Symbol)
			key = key.symbol;
		if(this.members.hasOwnProperty(key))
			return this.members[key];
		if(this.parent !== undefined)
			return this.parent.get(key);
		console.error(this.members);
		console.error('Key not found:', key);
		throw new KeyNotFoundException(key, this);
	};
	Environment.prototype.define = function(key, value) {
		if(key.constructor === Symbol)
			key = key.symbol;
		return this.members[key] = value;
	};
	Environment.prototype.set = function(key, value) {
		if(key.constructor === Symbol)
			key = key.symbol;
		if(this.members.hasOwnProperty(key))
			return this.define(key, value);
		if(this.parent !== undefined)
			return this.parent.set(key, value);
		throw new KeyNotFoundException(key, this);
	};
	Environment.prototype.update = function(names, values) {
		if(names.prototype === Symbol) {
			names = [names.symbol];
			values = [values];
		}
		for(var i = 0; i < names.length; ++i)
			this.define(names[i], values[i]);
	};
	function Lambda (args, body, env) {
		this.args = args;
		this.body = body;
		this.env  = env;
	}
	function Macro (args, body, env) {
		this.args = args;
		this.body = body;
		this.env  = env;
	}
	function Tuple (members) {
		this.members = members;
	}
	function MakeTuple () {
		var tuple = [];
		tuple.__proto__ = Tuple;
		tuple.tuple = new Tuple(Array.prototype.slice.call(arguments));
		for(var i = 0; i < tuple.tuple.members.length; ++i)
			tuple.push(tuple.tuple.members[i]);
		return tuple;
	}
	function Eval (X, Env) {
		while(true) {
			if(debugMode) console.error("Eval:", X);
			if(X === undefined || X === null) return X;
			if(X.constructor === Symbol) return Env.get(X.symbol);
			if(X.constructor !== Array) return X;
			var first = X[0];
			if(first.constructor === Symbol)
				first = first.symbol;
			switch(first) {
				case 'if': // (if Cond Conseq Alt=Nil)
					var Cond = X[1];
					var Conseq = X[2];
					var Alt = null;
					if(X.length > 2)
						Alt = X[3];
					X = (Eval(Cond, Env) === false) ? Alt : Conseq;
					continue; // tail recurse
				case 'quote': // (quote Exp)
					return X[1];
				case 'define': // (define Name Value)
					var Name = X[1];
					if(Name.constructor === Symbol)
						Name = Name.symbol;
					return Env.define(Name, Eval(X[2], Env));
				case 'set!': // (set! Name Value) must exist
					var Name = X[1];
					if(Name.constructor === Symbol)
						Name = Name.symbol;
					return Env.set(Name, Eval(X[2], Env));
				case 'lambda': // (lambda Args Body)
					return new Lambda(X[1], X[2], Env);
				case 'macro': // (macro Args Body)
					return new Macro(X[1], X[2], Env);
				case 'begin': // (begin Exps)
					var Exps = X.slice(1);
					while(Exps.length > 1)
						Eval(Exps.shift(), Env);
					return Eval(Exps.shift(), Env);
			}
			var proc = Eval(X[0], Env);
			var exps = X.slice(1);
			if(proc.constructor !== Macro)
				exps = exps.map(Y => Eval(Y, Env));
			if(proc.constructor === Lambda || proc.constructor === Macro) {
				var newEnv = new Environment(proc.env);
				newEnv.update(proc.args, exps);
				if(proc.constructor === Lambda) {
					X = proc.body;
					Env = newEnv;
				} else {
					X = Eval(proc.body, newEnv);
				}
				continue; // tail recurse
			} else if(typeof proc === 'function') {
				return proc(exps, Env);
			} else {
				console.error("Proc:", proc);
				console.error("Exps:", exps);
				throw new InvalidOperationException();
			}
		}
	}
	var oldEval = Eval;
	if(debugMode) {
		Eval = function(X, Env) {
			console.error("Eval(", X, ")");
			var result = oldEval(X, Env);
			console.error("Eval(", X, "):", result);
			return result;
		};
	}
	function to_s (val) {
		if(val === undefined) return 'undefined';
		if(val === null) return 'nil';
		if(val.prototype === Symbol) return val.symbol;
		return val.toString();
	}
	// To avoid new functions being created each call to the +, -, *, and / operators,
	// their logic functions are created here and then just referenced in
	// the operator logic.
	var ops = {
		'+': (a, n) => a + n, '-': (a, n) => a - n,
		'*': (a, n) => a * n, '/': (a, n) => a / n,
	};
	var StdLib = {
		'undefined': Args => undefined,
		'nil': Args => null,
		'false': Args => false,
		'true': Args => true,
		// Uses cached operators to avoid creating new function enclosures.
		// All four mathematical operators can be implemented using the reduce
		// method.
		'+': Args => Args.reduce(ops['+']),
		'-': Args => Args.reduce(ops['-']),
		'*': Args => Args.reduce(ops['*']),
		'/': Args => Args.reduce(ops['/']),
		'<': Args => Args[0] < Args[1],
		'<=': Args => Args[0] <= Args[1],
		'>': Args => Args[0] > Args[1],
		'>=': Args => Args[0] >= Args[1],
		'to_s': Args => to_s(Args[0]),
		'print': Args => console.log(Args.join(' ')),
		'car': Args => Args[0][0],
		'cdr': Args => Args.slice(1),
		'cons': Args => Args[0].concat(Args[1]),
		'equal?': Args => Args[0] === Args[1],
		'length': Args => Args[0].length,
		'list': Args => Args,
		'list?': Args => Args[0] && Args[0].prototype === Array,
		'not': Args => !Args[0],
		'null?': Args => Args.length && (!Args[0] || Args[0].length === 0),
		'number?': Args => Args.length && typeof Args[0] === 'number',
		'procedure?': Args => Args.length && typeof Args[0].prototype === 'function',
		'symbol?': Args => Args.length && Args[0].prototype === Symbol,
		'lambda?': Args => Args.length && Args[0].prototype === Lambda,
		'macro?': Args => Args.length && Args[0].prototype === Macro,
		'env?': Args => Args.length && Args[0].prototype === Environment,
		'env:current': (Args, Env) => Env,
		'env:new': Args => new Environment(Args[0]),
		'env:get': Args => Args[0].get(Args[1]),
		'env:define': Args => Args[0].define(Args[1], Args[2]),
		'env:set': Args => Args[0].set(Args[1], Args[2]),
		'dict:new': Args => new Object(),
		'dict:get': Args => Args[0][to_s(Args[1])],
		'dict:set': Args => Args[0][to_s(Args[1])] = Args[1],
		'dict:update': Args => { Args[0][to_s(Args[1])] = Args[1]; return Args[0]; },
		'dict:key?': Args => Args.length && Args[0].hasOwnProperty(to_s(Args[1])),
		'require': Args => require(to_s(Args[0])),
		// (js:call Object Method Arguments...)
		'js:call': Args => {
			return Args[1].apply(Args[0], Args.slice(2));
		},
	};
	function AddStdLib (env) {
		for(var key in StdLib)
			env.define(key, StdLib[key]);
		return env;
	}

	function Test () {
		var e = new Environment();
		AddStdLib(e);
		var code = ['begin',
			[new Symbol('print'), "Hello, world!"],
			[new Symbol('define'), 'add', ['lambda', ['X', 'Y'],
				[new Symbol('+'), new Symbol('X'), new Symbol('Y')]
			]],
			[new Symbol('define'), 'A', 5],
			[new Symbol('define'), 'B', 10],
			[new Symbol('print'), new Symbol('A'), "+", new Symbol('B'), "=",
				[new Symbol('add'), new Symbol('A'), new Symbol('B')]
			],
			['define', new Symbol('fac1'), ['lambda', ['N'],
				['if', [new Symbol('<='), new Symbol('N'), 1],
					1,
					/* else */
					// (* N (fac1 (- N 1)))
					[new Symbol('*'), new Symbol('N'),
						[new Symbol('fac1'), [new Symbol('-'), new Symbol('N'), 1]]
					]
				]
			]],
			['define', new Symbol('fac2'), ['lambda', ['N'],
				// (fac2a N 1)
				[new Symbol('fac2a'), new Symbol('N'), 1]
			]],
			['define', new Symbol('fac2a'), ['lambda', ['N', 'A'],
				// (if(<= N 1)
				//     A
				//     (fac2a (- N 1) (* N A)))
				['if', [new Symbol('<='), new Symbol('N'), 1],
					new Symbol('A'),
					[new Symbol('fac2a'),
						[new Symbol('-'), new Symbol('N'), 1],
						[new Symbol('*'), new Symbol('N'), new Symbol('A')]
					]
				]
			]],
			[new Symbol('print'), "Fac1", new Symbol('B'), "=", [new Symbol('fac1'), new Symbol('B')]],
			[new Symbol('print'), "Fac2", new Symbol('B'), "=", [new Symbol('fac2'), new Symbol('B')]],
			// Open and print a file
			['define', new Symbol('FS'), [new Symbol('require'), "fs"]],
			// (print "Size of lispy.js:"
			//      (length (to_s (js:call FS (dict:get FS 'readFileSync) 'lispy.js'))))
			[new Symbol('print'), "Size of lispy.js:",
				[new Symbol('length'),
					[new Symbol('to_s'), [new Symbol('js:call'),
						new Symbol('FS'),
						[new Symbol('dict:get'), new Symbol('FS'), 'readFileSync'],
						'lispy.js'
					]]
				]
			],
		];
		var start = new Date();
		var codeStr = "(begin\r" +
			"(print \"Hello, world!\")\r" +
			"(define add (lambda (X Y) (+ X Y)))\r" +
			"(define A 5)\r" +
			"(define B 10)\r" +
			"(print A \"+\" B \"=\" (add A B))\r" +
		")";
		code = Parse(codeStr);
		console.log(Eval(code, e));
		console.log("Run in " + (new Date() - start) + "ms");
	}

	return {
		Symbol: Symbol,
		Environment: Environment,
		Lambda: Lambda,
		Macro: Macro,
		Tuple: Tuple,
		MakeTuple: MakeTuple,
		Eval: Eval,
		AddStdLib: AddStdLib,
		Test: Test
	};
})();

helpMode = helpMode || (programFile === undefined);
if(testMode) {
	Lispy.Test();
} else if(helpMode) {
	console.error(process.argv[1] + " [-d] [-T] [file.lisp] [--] [arguments...]");
	console.error();
	console.error("Usage:");
	console.error("       -d           Enable debug mode");
	console.error("       -T           Run tests");
	console.error("       file.lisp    File to run");
	console.error("       --           End Lispy argument passing");
	console.error("       arguments... Arguments to pass");
	process.exit(1);
} else {
	console.log("Target:", programFile);
	console.log("Arguments:", programArguments);
}
