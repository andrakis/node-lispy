/**
 * Module: Jumptable
 *
 * A jumptable allows simple pattern matching and lookup.
 *
 * For now, they're just dictionaries.
 * Every key points to a function that will handle the next
 * stage of evaluation. Think of it like a state machine.
 */

"use strict";

const Lispy  = require('..');
const StdLib = Lispy.StdLib;

//	(define _    "_")
const _ = "_";
exports['_'] = _;
//	(define new (lambda () (dict:new)))
exports['new'] = () => new Object();
//	(define update (lambda Args (proc:apply dict:update Args)))
exports['update'] = (Table, Key, Value) => StdLib['dict:update'](Table, Key, Value);
//	(define set (lambda (Table Key Value) (dict:set Table Key Value)))
exports['set'] = (Table, Key, Value) => StdLib['dict:set'](Table, Key, Value);
//	(define key (lambda (Table Key) (begin
//		(if (dict:key? Table (to_s Key))
//			Key
//			_
//		)
//	)))
exports['key'] = (Table, Key) => (StdLib['to_s'](Key) in Table) ? Key : _;
//	(define get (lambda (Table Key)
//		(dict:get Table (key Table (to_s Key)))))
//
exports['get'] = (Table, Key) => StdLib['dict:get'](Table, exports['key'](Table, StdLib['to_s'](Key)));

