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
 *  Symbol            A Lisp symbol.
 *  Environment       Lisp environment with parent support.
 *  Lambda            A Lisp lambda, with arguments, body, and pointer to environment.
 *  Macro             A special type of Lambda that does not immediately evaluate the
 *                    arguments.
 *  SpecialFunction   A builtin procedure that can reference the current environment.
 *  Tuple             A special type of list.
 *
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
var tSeparators = "()[]{}";
function tokenise(str) {
	var tokens = [];
	var s = 0, t; // string counters, use s for most and t when required
	while(s < str.length) {
		while (isspace(str[s]))                    // Skip whitespace
			++s;
		if (str.substr(s, 2) === ';;')             // Skip comment lines
			while(s < str.length && str[s] !== '\n' && str[s] !== '\r')
				++s;
		else if(tSeparators.indexOf(str[s]) != -1) // List open or close
			tokens.push(str[s++]);
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
			while (t < str.length && !isspace(str[t]) &&
			       tSeparators.indexOf(str[t]) == -1)
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
		// (: normal List open
		var cells = [];
		while (tokens[0] !== ")") {
			cells.push(read_from(tokens));
			if (tokens.length === 0) throw new ParserError("Missing closing )");
		}
		if (tokens.length === 0) throw new ParserError("Missing closing )");
		tokens.shift(); // discard closing )
		return cells;
	} else if (token === "[") {
		// [: auto list open (converts to (list ...))
		var cells = [new Symbol('list')];
		while (tokens[0] !== "]") {
			cells.push(read_from(tokens));
			if (tokens.length === 0) throw new ParserError("Missing closing ]");
		}
		if (tokens.length === 0) throw new ParserError("Missing closing ]");
		tokens.shift(); // discard closing )
		return cells;
	} else if (token === "{") {
		// {: tuple open (converts to tuple)
		var cells = [new Symbol('tuple')];
		while (tokens[0] !== "}") {
			cells.push(read_from(tokens));
			if (tokens.length === 0) throw new ParserError("Missing closing }");
		}
		if (tokens.length === 0) throw new ParserError("Missing closing }");
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
		Environment.Count++;
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
	dump(key) {
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
		if(key) console.error("Key not found:", key);
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
	keys() {
		var keys = [];
		if (this.parent) keys = this.parent.keys();
		keys = keys.concat(Object.keys(this.members));
		return keys;
	}
	toplevel() {
		var toplevel = this;
		while(toplevel.parent) toplevel = toplevel.parent;
		return toplevel;
	}
}
Environment.Count = 0;
class Lambda {
	constructor(args, body, env, evaluator) {
		this.args = args;
		this.body = body;
		this.env  = env;
		this.evaluator = evaluator || Eval;
	}
	toString() { return '#Lambda'; };
}
function MakeCallableLambda (lambda) {
	var fn = function() {
		var targetEnv = new Environment(lambda.env);
		targetEnv.update(lambda.args, slice.call(arguments));
		return lambda.evaluator(lambda.body, targetEnv);
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
		// Make this look like an Array
		for(var key in members)
			this[key] = members[key];
	}
	toString() {
		return "{" + this.members.map(to_string_mapper).join(" ") + "}";
	}
	map() { return this.members.map(...arguments); }
	forEach() { return this.members.forEach(...arguments); }
}
function inspect (obj, maxlength) {
	return to_string(obj, true);//.substr(0, maxlength);
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
				return MakeCallableLambda(new Lambda(X[1], X[2], Env, Eval));
			case 'macro': // (macro Args Body)
				return new Macro(X[1], X[2], Env);
			case 'begin': // (begin Exps)
				var Exps = X.slice(1);
				while(Exps.length > 1)
					Eval(Exps.shift(), Env);
				X = Exps.shift();
				continue; // tail recurse
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
		if(proc.constructor === Macro) {
			var newEnv = new Environment(proc.env);
			newEnv.update(proc.args, exps);
			X = Eval(proc.body, newEnv);
			continue; // tail recurse
		}
		exps = exps.map(Y => Eval(Y, Env));
		if(proc.constructor === SpecialFunction) {
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
	return debug;
}

// to_s: convert to string simply
function to_s (val) {
	if(val === null) return 'nil';
	else if(val && val.constructor === Symbol) return val.symbol;
	return String(val);
}
// to_string: convert to string extensively
function to_string (val, withquotes) {
	if(val === undefined) return 'undefined';
	if(val === null) return 'nil';
	if(val.constructor === Symbol) return val.toString();
	if(withquotes && typeof val === 'string') return '"' + val + '"';
	if(typeof val === 'function' && val.__proto__ === Lambda)
		return val.lambda.toString();
	if(val.constructor === Array)
		return "[" + val.map(v=>to_string(v, withquotes)).join(" ") + "]";
	if(val.__proto__ === Tuple)
		return "{" + val.map(v=>to_string(v, withquotes)).join(" ") + "}";
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
	'proc': new Symbol('proc'),
	'sproc': new Symbol('sproc'),
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
	if (x.constructor === SpecialFunction) return Types['sproc'];
	if (x.constructor === Macro) return Types['macro'];
	if (x.constructor === Environment) return Types['environment'];
	if (typeof x === 'object') return Types['object'];
	throw new UnexpectedInputError("Unknown object type: " + typeof x);
}
var to_string_mapper = (v) => to_string(v);
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
	// TODO: hacky, but symbols need to be comparable to each other
	'=': (a, b) =>
		((a && a.constructor === Symbol) ? a.symbol : a) ==
		((b && b.constructor === Symbol) ? b.symbol : b),
	'!=':(a, b) => a != b,
	'===': (a, b) => a === b,
	'!==': (a, b) => a !== b,
	'to_s': x => to_s(x),
	'to_string': (val, withquotes) => to_string(val, withquotes),
	'split': (s, r) => s.split(r),
	'join': (s, j) => s.join(j),
	'regexp': (pattern, flags) => new RegExp(pattern, flags),
	'print': ManyArgs(Args => console.log(Args.map(to_string_mapper).join(' '))),
	'log': ManyArgs(Args => console.log(...Args)),
	'car': x => x[0],
	'head': x => x[0],
	'cdr': x => x.slice(1),
	'tail': x => x.slice(1),
	'slice': ManyArgs(Args => Args[0].slice(...Args.slice(1))),
	'cons': (a, b) => [a].concat(b),
	'concat': (a, b) => a.concat(b),
	'equal?': (a, b) => a === b,
	'length': x => x.length,
	'tuple': ManyArgs(Args => new Tuple(Args)),
	'list': ManyArgs(Args => Args),
	'regexp': ManyArgs(Args => new RegExp(...Args)),
	'date': ManyArgs(Args => new Date(...Args)),
	'list?': x => x.constructor === Array,
	'index': (list, index) => list[index],
	'last': list => list[list.length ? list.length - 1 : 0],
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
	'env:get': (env, key) => env.get(key),
	'env:define': (env, key, value) => env.define(key, value),
	'env:defined?': (env, key) => env.present(key),
	'env:set!': (env, key, value) => env.set(key, value),
	'env:update': (env, keys, values) => env.update(keys, values),
	'env:dump': env => env.dump(),
	'env:parent': env => env.parent,
	'env:parent?': env => !!env.parent,
	'env:toplevel': env => env.toplevel(),
	'env:keys': env => env.keys(),
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
	'kernel:debug?': () => Eval === DebugEval,
	'kernel:debug': bool => SetDebug(bool),
	'proc:apply': (Proc, Args) => Proc(...Args),
	'proc:objectapply': (Obj, Member, Args) => Obj[to_s(Member)](...Args),
	'lambda:new' : (Args, Body, Env, Evaluator) =>
		MakeCallableLambda(new Lambda(Args, Body, Env, Evaluator)),
	'lambda:args': lambda => lambda.lambda.args,
	'lambda:body': lambda => lambda.lambda.body,
	'lambda:env' : lambda => lambda.lambda.env,
	'lambda:evaluator': lambda => lambda.lambda.evaluator,
	'macro:new' : (Args, Body, Env) => new Macro(Args, Body, Env),
	'macro:args': macro => macro.args,
	'macro:body': macro => macro.body,
	'macro:env' : macro => macro.env,
	'error'     : e => { throw e; },
	'error:custom': (Name, Message) => new CustomError(Name, Message),
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
		env.dump(key);
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
class CustomError extends Error {
	constructor(name, message) {
		super(message);
		this.name = name;
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
		var fileContent = fs.readFileSync(programFile, 'utf8');
		var env = new Environment(StandardEnvironment);
		// Open core.lisp and execute that in the target environment
		var start = new Date();
		// Add any arguments as an environment variable
		env.define('argv', programArguments);
		// Set __main__ to identify as the startup file
		env.define('__main__', true);
		// Set a dummy exports target
		env.define('exports', {});
		start = new Date();
		var code = Parse(fileContent);
		var now = new Date();
		if (timeMode) console.error("Parsed in " + (now - start) + "ms");
		start = now;
		Eval(code, env);
		if (timeMode)
			process.on('exit', () => {
				console.error("Executed in " + (new Date() - start) + "ms");
				console.error("In total, " + Environment.Count + " Environments were constructed");
			});
	}
}

var StandardEnvironment = new Environment();
AddStdLib(StandardEnvironment);
var CoreEnvironment = new Environment(StandardEnvironment);
// Load core.lisp
(function () {
	var coreContent = fs.readFileSync("core.lisp", 'utf8');
	var coreParsed  = Parse(coreContent);
	var coreEvaluate= Eval(coreParsed, CoreEnvironment);
})();

// Require a Lispy module like you would a NodeJS module
function Require (path) {
	var module = CoreEnvironment.get('import-require')(path);
	// Strip the module name from all keys
	Object.keys(module).forEach(key => {
		module[key.replace(/^.*?:/, '')] = module[key];
		delete module[key];
	});
	return module;
}

var exps = {
	Symbol: Symbol,
	Environment: Environment,
	Lambda: Lambda,
	Macro: Macro,
	Tuple: Tuple,
	Eval: Eval,
	Require: Require,
	SetDebug: SetDebug,
	AddStdLib: AddStdLib,
	StandardEnvironment: StandardEnvironment,
	CoreEnvironment: CoreEnvironment,
	Parse: Parse,
	Main: Main,
	KeyNotFoundError: KeyNotFoundError,
	ParserError: ParserError,
	UnexpectedInputError: UnexpectedInputError,
	InvalidArgumentError: InvalidArgumentError,
	InvalidOperationError: InvalidOperationError,
	UnreachableError: UnreachableError,
};

for(var key in exps)
	exports[key] = exps[key];

// If not required as a module, invoke Main
if (typeof module !== 'undefined' && !module.parent)
	Main();

