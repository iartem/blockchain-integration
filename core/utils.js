const crypto = require('crypto');

const utils = {
	isHex: (str, length) => {
		if (!/^[0-9A-F]+$/i.test(str)) {
			return false;
		}
		return length === undefined || str.length === length;
	},
	randHex: (bytes) => {
		return crypto.randomBytes(bytes).toString('hex');
	},
	wait: (ms) => {
		return new Promise(resolve => {
			setTimeout(resolve, ms);
		});
	},
	waitToResolve: (f, delay, maxAttempts) => {
		return new Promise(async (resolve, reject) => {
			var error;
			for (var i = 0; i < maxAttempts; i--) {
				try {
					resolve(f());
					return;
				} catch (e) {
					error = e;
					await utils.wait(delay);
				}
			}
			reject(error || 'No error in waitToResolve');
		});
	},
	promiseSerial: funcs => {
		return new Promise((resolve, reject) => {
			let results = [];
			function next (result) {
				results.push(result);

				if (funcs.length === 0) {
					results.shift();
					resolve(results);
				} else {
					let promiser = funcs.shift();
					promiser().then(next, reject);
				}
			}
			next();
		});
		// for (f in func)
		// return funcs.reduce((promise, func) =>
		// 	promise.then(result => func().then(Array.prototype.concat.bind(result))),
		// 	Promise.resolve([]));
	}
};

module.exports = utils;