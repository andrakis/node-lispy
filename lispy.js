#!/usr/bin/env node
/**
 * Lispy.js
 *  A port of Lis.py to Node.js
 *
 * A special feature is that lambdas are native JavaScript functions,
 * with some extra properties, meaning they can be called from any
 * JavaScript function with no special handling.
 * Next, it uses the function(...args) operator to call functions
 * with arbritrary parameters, rather than Object.apply which requires
 * a context parameter to work with many classes.
 * Further, any JavaScript function can be called, including those within
 * classes, allowing usage of any JavaScript library / module within Lispy.
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
var util = require('util');

var debugMode = false;

var startOf = str => str.length ? str[0] : '';
var endOf   = str => str.length ? str[str.length - 1] : '';
var isspace = c => c === ' ' || c === '\t' || c === '\r' || c === '\n';
var ascii0  = '0'.charCodeAt(0);
var ascii9  = '9'.charCodeAt(0);
var isdigit = c =>
	(c === '') ? false :
		(typeof c === 'string') ? isdigit(c.charCodeAt(0)) :
			(c >= ascii0 && c <= ascii9);

class Symbol {
	constructor(name) { this.symbol = name; }
	toString() { return "'" + this.symbol; }
}
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
	if (startOf(token) === '"' && endOf(token) === '"') {
		// Use eval to get the correct string representation.
		return token.substr(1, token.length - 2).replace(/(\\.)/g,
			(m) => {
				if (m.match(/\\[tv0bfnr'"\\]/))
					return eval('"' + m + '"')
				// Not a recognised escape code, return the next
				// character instead.
				return m[1];
			});
	}
	if (isdigit(token[0]) || token.length > 1 && token[0] === '-' && isdigit(token[1])) {
		// coerce token to a number by calling Number class
		return Number(token);
	}
	return new Symbol(token);
}
function read_from(tokens) {
	if (tokens.length === 0) throw new ParserError("Missing opening token");

	var token = tokens.shift();
	if (token === "(") {
		var cells = [];
		while (tokens[0] !== ")") {
			cells.push(read_from(tokens));
			if (tokens.length === 0) throw new ParserError("Missing closing )");
		}
		if (tokens.length === 0) throw new ParserError("Missing closing )");
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
class Environment {
	constructor(parent) {
		this.members = {};
		this.parent  = parent;
	}
	toString() {
		return '#Environment';
	}
	present(key) {
		if(key.constructor === Symbol)
			key = key.symbol;
		if(key in this.members)
			return true;
		if(this.parent !== undefined)
			return this.parent.present(key);
		return false;
	}
	get(key, from) {
		if(key.constructor === Symbol)
			key = key.symbol;
		if(key in this.members)
			return this.members[key];
		if(this.parent !== undefined)
			return this.parent.get(key, (from || this));
		throw new KeyNotFoundError(key, from);
	};
	dump() {
		var depth = 0;
		var target = this;
		var lines = [];
		while(target.parent) { depth++; target = target.parent; }
		target = this;
		do {
			var memberCount = 0;
			var spacer = '\t';
			lines.push(spacer + "}");
			for(var key in target.members) {
				var v = target.members[key];
				if (v === null) v = "null";
				else if(v === undefined) v = "undefined";
				else if(typeof v === 'function' && v.__proto__ === Lambda)
					v = v.lambda.toString();
				lines.push(spacer + "  '" + key + " => " + v.toString());
				memberCount++;
			}
			lines.push(spacer + "{ parent: " + (!!target.parent) + ", count: " + memberCount);
			depth--;
			target = target.parent;
		} while(target && target.parent);
		console.error(lines.reverse().join("\n"));
	}
	define(key, value) {
		if(key.constructor === Symbol)
			key = key.symbol;
		return this.members[key] = value;
	}
	set(key, value) {
		if(key.constructor === Symbol)
			key = key.symbol;
		if(key in this.members)
			return this.define(key, value);
		if(this.parent !== undefined)
			return this.parent.set(key, value);
		throw new KeyNotFoundError(key, this);
	}
	update(names, values) {
		if(names.constructor === Symbol) {
			names = [names.symbol];
			values = [values];
		}
		for(var i = 0; i < names.length; ++i)
			this.define(names[i], values[i]);
	}
}
class Lambda {
	constructor(args, body, env) {
		this.args = args;
		this.body = body;
		this.env  = env;
	}
	toString() { return '#Lambda'; };
}
function MakeCallableLambda (lambda) {
	var fn = function() {
		var targetEnv = new Environment(lambda.env);
		targetEnv.update(lambda.args, slice.call(arguments));
		return Eval(lambda.body, targetEnv);
	};
	fn.lambda = lambda;
	fn.__proto__ = Lambda;
	return fn;
}
// A SpecialFunction is a function(Arguments, CurrentEnvironment)
class SpecialFunction {
	constructor(handler) {
		this.handler = handler;
	}
	toString() { return this.handler.toString(); }
}
class Macro {
	constructor(args, body, env) {
		this.args = args;
		this.body = body;
		this.env  = env;
	}
}
class Tuple {
	constructor(members) {
		this.members = members;
	}
}
function MakeTuple (members) {
	var tuple = [];
	tuple.__proto__ = Tuple;
	tuple.tuple = new Tuple(members);
	tuple.members = members;
	for(var i = 0; i < members.length; ++i)
		tuple.push(members[i]);
	return tuple;
}
function inspect (obj, maxlength) {
	if (obj === undefined) return "'undefined";
	if (obj === null) return "'nil";
	if (obj.constructor === Symbol)
		return "'" + obj.symbol;
	if (obj.constructor === Array)
		return "[" + obj.map(inspect).join(' ').substr(0, maxlength) + "]";
	return util.inspect(obj).
		replace(/\r|\n/gm, '').
		substr(0, maxlength);
}
var shortInspectLength = 20;
var longInspectLength  = 40;
function NormalEval (X, Env) {
	while(true) {
		if(debugMode)
			console.error(depthStr() + "Eval(", inspect(X, shortInspectLength), ")");
		if(X === undefined || X === null) return X;
		if(X.constructor === Symbol) return Env.get(X.symbol);
		if(X.constructor !== Array) return X;
		var first = X[0];
		if(first.constructor === Symbol)
			first = first.symbol;
		switch(first) {
			case 'if': // (if Cond Conseq Alt=Nil)
				var Alt = (X.length > 2) ? X[3] : null;
				X = Eval(X[1], Env) ? X[2] : Alt;
				continue; // tail recurse
			case 'quote': // (quote Exp)
				return X[1];
			case 'define': // (define Name Value)
				return Env.define(X[1], Eval(X[2], Env));
			case 'defined?': // (defined? Name)
				return Env.present(X[1]);
			case 'set!': // (set! Name Value) must exist
				return Env.set(X[1], Eval(X[2], Env));
			case 'lambda': // (lambda Args Body)
				return MakeCallableLambda(new Lambda(X[1], X[2], Env));
			case 'macro': // (macro Args Body)
				return new Macro(X[1], X[2], Env);
			case 'begin': // (begin Exps)
				var Exps = X.slice(1);
				while(Exps.length > 1)
					Eval(Exps.shift(), Env);
				X = Exps.shift();
				continue;
			case 'try': // (try Operation ErrorHandler)
				// ErrorHandler is not evaulated until an error is caught
				try {
					return Eval(X[1], Env);
				} catch (e) {
					var handler = Eval(X[2], Env);
					if (typeof handler !== 'function') {
						console.error("Handler:", handler);
						throw new InvalidArgumentError('try requires a function/lambda for exception handler');
					}
					if (handler.__proto__ === Lambda) {
						Env = new Environment(handler.lambda.env);
						Env.update(handler.lambda.args, [e]);
						X = handler.lambda.body;
						continue; // tail recurse
					} else {
						return handler(e);
					}
				}
				throw new UnreachableError();
		}
		var proc = Eval(X[0], Env);
		var exps = X.slice(1);
		if(proc.constructor !== Macro)
			exps = exps.map(Y => Eval(Y, Env));
		if(proc.constructor === Macro) {
			var newEnv = new Environment(proc.env);
			newEnv.update(proc.args, exps);
			X = Eval(proc.body, newEnv);
			continue; // tail recurse
		} else if(proc.constructor === SpecialFunction) {
			return proc.handler(exps, Env);
		} else if(typeof proc === 'function') {
			if (proc.__proto__ === Lambda) {
				var newEnv = new Environment(proc.lambda.env);
				newEnv.update(proc.lambda.args, exps);
				X = proc.lambda.body;
				Env = newEnv;
				continue; // tail recurse
			} else {
				return proc(...exps);
			}
		} else {
			// Interepreted as a call to a member function
			var method = to_s(exps[0]);
			var args = exps.slice(1);
			return proc[method](...args);
		}
	}
}
function depthStr () {
	var str = "";
	if (depth < 20)
		str = "=".repeat(depth - 1) + " | ";
	else
		str = "=                " + depth + " | ";
	return str;
}
function DebugEval (X, Env) {
	depth++;
	var result;
	try {
		result = NormalEval(X, Env);
	} catch (e) {
		depth--;
		throw e;
	}
	console.error(depthStr() + "Eval(", inspect(X, shortInspectLength), "):",  inspect(result, longInspectLength));
	depth--;
	return result;
}
var Eval = NormalEval;
var depth = 0;
function SetDebug (debug) {
	Eval = debug ? DebugEval : NormalEval;
}

// to_s: convert to string simply
function to_s (val) {
	if(val === undefined) return 'undefined';
	if(val === null) return 'nil';
	if(val.constructor === Symbol) return val.symbol;
	return val.toString();
}
// to_string: convert to string extensively
function to_string (val) {
	if(val === undefined) return 'undefined';
	if(val === null) return 'nil';
	if(val.constructor === Symbol) return val.toString();
	if(typeof val === 'function' && val.__proto__ === Lambda)
		return val.lambda.toString();
	return val.toString();
}
var slice  = Array.prototype.slice,
	join   = Array.prototype.join,
	reduce = Array.prototype.reduce;

// To avoid new functions being created each call to the +, -, *, and / operators,
// their logic functions are created here and then just referenced in
// the operator logic.
var ops = {
	'+': (a, n) => a + n, '-': (a, n) => a - n,
	'*': (a, n) => a * n, '/': (a, n) => a / n,
};
function ManyArgs (Callback) {
	return function() { return Callback(slice.call(arguments)); }
}
var Types = {
	'undefined': new Symbol("undefined"),
	'nil': new Symbol("nil"),
	'number': new Symbol("number"),
	'string': new Symbol("string"),
	'symbol': new Symbol("symbol"),
	'list': new Symbol("list"),
	'object': new Symbol("object"),
	'environment': new Symbol('environment'),
	'lambda': new Symbol('lambda'),
	'macro': new Symbol('macro'),
	'proc': new Symbol('proc')
};
function LispyTypeOf (x) {
	if (x === undefined) return Types['undefined'];
	if (x === null) return Types['nil'];
	if (x.constructor === Array) return Types['list'];
	if (typeof x === 'number') return Types['number'];
	if (typeof x === 'string') return Types['string'];
	if (x.constructor === Symbol) return Types['symbol'];
	if (typeof x === 'function') {
		if (x.__proto__ == Lambda)
			return Types['lambda'];
		return Types['proc'];
	}
	if (x.constructor === SpecialFunction) return Types['proc'];
	if (x.constructor === Macro) return Types['macro'];
	if (x.constructor === Environment) return Types['environment'];
	if (typeof x === 'object') return Types['object'];
	throw new UnexpectedInputError("Unknown object type: " + typeof x);
}
var StdLib = {
	'undefined': undefined,
	'nil': null,
	'false': false,
	'true': true,
	// Uses cached operators to avoid creating new function enclosures.
	// All four mathematical operators can be implemented using the reduce
	// method.
	'+': ManyArgs(Args => reduce.call(Args, ops['+'])),
	'-': ManyArgs(Args => reduce.call(Args, ops['-'])),
	'*': ManyArgs(Args => reduce.call(Args, ops['*'])),
	'/': ManyArgs(Args => reduce.call(Args, ops['/'])),
	'<': (a, b) => a < b,
	'<=':(a, b) => a <= b,
	'>': (a, b) => a > b,
	'>=':(a, b) => a >= b,
	'=': (a, b) => a == b,
	'!=':(a, b) => a != b,
	'===': (a, b) => a === b,
	'!==': (a, b) => a !== b,
	'to_s': x => to_s(x),
	'split': (s, r) => s.split(r),
	'join': (s, j) => s.join(j),
	'regexp': (pattern, flags) => new RegExp(pattern, flags),
	'print': ManyArgs(Args => console.log(Args.map(to_string).join(' '))),
	'log': ManyArgs(Args => console.log(...Args)),
	'car': x => x[0],
	'head': x => x[0],
	'cdr': x => x.slice(1),
	'tail': x => x.slice(1),
	'slice': ManyArgs(Args => Args[0].slice(...Args.slice(1))),
	'cons': (a, b) => a.concat(b),
	'equal?': (a, b) => a === b,
	'length': x => x.length,
	'list': ManyArgs(Args => Args),
	'list?': x => x.constructor === Array,
	'map': (list, callback) => list.map(callback),
	'each': (list, callback) => list.forEach(callback),
	'reduce': (list, callback) => list.reduce(callback),
	'not': x => !x,
	'and': (a, b) => a && b,
	'or': (a, b) => a || b,
	'null?': x => (!x || x.length === 0),
	'number?': x => typeof x === 'number',
	'procedure?': x => typeof x === 'function' && x.__proto__ !== Lambda,
	'symbol?': x => x.constructor === Symbol,
	'lambda?': x => x.__proto__ === Lambda,
	'macro?': x => x.constructor === Macro,
	'env?': x => x.constructor === Environment,
	'typeof': x => LispyTypeOf(x),
	'env:current': new SpecialFunction((Args, Env) => Env),
	'env:new': pEnv => new Environment(pEnv),
	'env:get': (env, key) => env[key],
	'env:define': (env, key, value) => env.define(key, value),
	'env:defined?': (env, key) => env.present(key),
	'env:set': (env, key, value) => env.set(key, value),
	'env:dump': env => env.dump(),
	'env:parent': env => env.parent,
	'env:keys': env => Object.keys(env.members),
	'dict:new': () => new Object(),
	'dict:get': (dict, key) => dict[to_s(key)],
	'dict:set': (dict, key, value) => dict[to_s(key)] = value,
	'dict:update': (dict, key, value) => {
		dict[to_s(key)] = value;
		return dict;
	},
	'dict:key?': (dict, key) => to_s(key) in dict,
	'dict:keys': dict => Object.keys(dict),
	'require': path => require(to_s(path)),
	'eval': (x, env) => Eval(x, env),
	'parse': s => Parse(s),
	'stdin': () => process.stdin,
	'stdout': () => process.stdout,
	'inspect': obj => util.inspect(obj),
};
function AddStdLib (env) {
	for(var key in StdLib)
		env.define(key, StdLib[key]);
	return env;
}

class KeyNotFoundError extends Error {
	constructor(key, env) {
		super("Key " + to_s(key) + " not found");
		this.name = "KeyNotFoundError";
		env.dump();
	}
}
class ParserError extends Error {
	constructor(reason) {
		super(reason);
		this.name = "ParserError";
	}
}
class UnexpectedInputError extends Error {
	constructor(message) {
		super(message);
		this.name = "UnexpectedInputError";
	}
}
class InvalidArgumentError extends Error {
	constructor(message) {
		super(message);
		this.name = "InvalidArgumentError";
	}
}
class InvalidOperationError extends Error {
	constructor(operation) {
		super("Invalid operation");
		this.name = "InvalidOperationError";
	}
}
class UnreachableError extends Error {
	constructor() {
		super("This code should not be reachable");
		this.name = "UnreachableError";
	}
}

function Main () {
	var helpMode  = false;
	var timeMode  = false;
	var programFile      = undefined;
	var programArguments = [];

	var argv = process.argv;
	var args = true; // whether accepting Lispy arguments or not
	if(argv.length > 2) {
		for(var i = 2; i < argv.length; ++i) {
			var v = argv[i];
			if(args && v === "--")
				args = false;
			else if(args && v === "-d")
				debugMode = true;
			else if(args && v === "-t")
				timeMode = true;
			else if(args && v.match(/^--?h(elp)?$/))
				helpMode = true;
			else if(programFile === undefined)
				programFile = v;
			else
				programArguments.push(v);
		}
	}

	helpMode = helpMode || (programFile === undefined);
	if(helpMode) {
		console.error(process.argv[1] + " [-d] [-t] [file.lisp] [--] [arguments...]");
		console.error();
		console.error("Usage:");
		console.error("       -d           Enable debug mode");
		console.error("       -t           Show timing information");
		console.error("       file.lisp    File to run");
		console.error("       --           End Lispy argument passing");
		console.error("       arguments... Arguments to pass");
	} else {
		SetDebug(debugMode);
		var fileContent = fs.readFileSync(programFile);
		var globalEnv = new Environment();
		AddStdLib(globalEnv);
		var env = new Environment(globalEnv);
		// Add any arguments as an environment variable
		env.define('argv', programArguments);
		var start = new Date();
		var code = Parse(fileContent.toString());
		var now = new Date();
		if (timeMode) console.error("Parsed in " + (now - start) + "ms");
		start = now;
		Eval(code, env);
		if (timeMode) console.error("Executed in " + (new Date() - start) + "ms");
	}
}

var exps = {
	Symbol: Symbol,
	Environment: Environment,
	Lambda: Lambda,
	Macro: Macro,
	Tuple: Tuple,
	MakeTuple: MakeTuple,
	Eval: Eval,
	AddStdLib: AddStdLib,
	Parse: Parse,
	Main: Main,
};

for(var key in exps)
	exports[key] = exps[key];

// If not required as a module, invoke Main
if (typeof module !== 'undefined' && !module.parent)
	Main();

