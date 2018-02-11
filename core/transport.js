const request = require('request'),
	log = require('./log.js')('transport');

class HttpTransport {
	constructor({host, port, url, auth, retryPolicy, conf={timeout: 3000, headers: {accept: 'application/json'}}}) {
		this.conf = {
			url: url || `http://${host}:${port || 80}`,
			timeout: conf.timeout || 3000,
			headers: conf.headers
		};
		if (auth) {
			this.conf.auth = auth;
			this.conf.auth.sendImmediately = false;
		}
		if (retryPolicy) {
			this.retryPolicy = retryPolicy;
		} else {
			this.retryPolicy = (error, attempt) => {
				if (error === null) {
					return attempt < 3;
				} else {
					if ((typeof error === 'number' && error >= 300 && error < 500) && error.code !== 'ETIMEDOUT') {
						return false;
					} 
					return true;
				}
			};
		} 
	}

	request(path='/', method='GET', params='', checker) {
		var conf = Object.assign({}, this.conf, {method: method});
		if (method === 'GET') {
			if (params && typeof params === 'object') {
				conf.url = conf.url + (path || '') + '?' + Object.keys(params).map(k => `${k}=${encodeURIComponent(params[k])}`).join('&');
			} else {
				conf.url = conf.url + (path || '') + (params ? '?' + params : '');
			}
		} else if (method === 'POST' && params) {
			conf.url = conf.url + (path || '');
			if (typeof params === 'string') {
				conf.headers['content-type'] = 'application/x-www-form-urlencoded';
				conf.body = params;
			} else if (typeof params === 'object') {
				conf.headers['content-type'] = 'application/json';
				conf.body = JSON.stringify(params);
			}
		}
		log.debug(`Sending ${method} to ${path}`);
		log.debug(`params: ${JSON.stringify(params)}`);
		return new Promise((resolve, reject) => {
			request(conf, (err, res, body) => {
				if (res && body) {
					log.debug(`Response ${res.statusCode}: ${res.headers['content-type']} ${body}`);
				}
				if (err) {
					log.warn(err, `Error for ${method} to ${path}`);
					reject(res ? res.statusCode : err || err);
				} else if (res.statusCode >= 200 && res.statusCode < 300) {
					var json;
					if (body) {
						try {
							json = JSON.parse(body);
						} catch (e) {
							// ignored
						}
					}
					// if (json && (res.headers['content-type'] === 'application/json') || (body[0] === '{' && body[body.length - 1] === '}')) {
					try {
						if (json) {
							if (checker) {
								let error = checker(json);
								if (error) {
									log.warn(`Response validation error ${JSON.stringify(error)} for ${method} to ${path}: ${body}`);
								} else {
									log.debug(`Success for ${method} to ${path}`);
								}
								error ? reject(error) : resolve(json);
							} else {
								log.debug(`Success for ${method} to ${path}`);
								resolve(json);
							}
						} else {
							if (checker) {
								let error = checker(body);
								if (error) {
									log.warn(`Response validation error ${JSON.stringify(error)} for ${method} to ${conf.url}: ${body}`);
								} else {
									log.debug(`Success for ${method} to ${path}`);
								}
								error ? reject(error) : resolve(body);
							} else {
								log.debug(`Success for ${method} to ${path}`);
								resolve(body);
							}
						}
					} catch (e) {
						log.debug(e, `Error for ${method} to ${path}`);
						reject(e);
					}
				} else {
					log.warn(`Error code ${res.statusCode} for ${method} to ${path}`);
					reject(res.statusCode);
				}
			});
		});
	}

	async retriableRequest(path='/', method='GET', params='', checker, retryPolicy, attempt=1) {
		if (!retryPolicy) {
			retryPolicy = this.retryPolicy;
		}
		var error = '';
		try {
			return await this.request(path, method, params, checker);
		} catch (e) {
			error = e;
			error = ['ESOCKETTIMEDOUT', 'ETIMEDOUT'].indexOf(error.code) !== -1 ||
					['ESOCKETTIMEDOUT', 'ETIMEDOUT'].indexOf(error.message) !== -1 ? 'timeout' : error;
			error = typeof error.code === 'number' ? error.code : error;

			if (!retryPolicy(error, attempt)) {
				log.error(e, `Unretriable error for ${method} to ${this.conf.url + (path === '/' || !path ? '' : path)}`);
				throw new Error(`Unretriable error for ${this.conf.url + (path === '/' || !path ? '' : path)}: ${e}`);
			}
		}
		if (retryPolicy(null, attempt)) {
			log.debug(`Retrying ${method} to ${path}`);
			return await this.retriableRequest(path, method, params, checker, retryPolicy, attempt + 1);
		} else {
			log.error(`All retries were spent for ${method} to ${this.conf.url + (path === '/' || !path ? '' : path)}`);
			throw new Error('All retries were spent, won\'t retry again' + (error ? ': ' + JSON.stringify(error) : ''));
		}
	}

	async get (path='/', params='', checker, retryPolicy) {
		return await this.retriableRequest(path, 'GET', params, checker, retryPolicy || this.retryPolicy);
	}

	async post (path='/', params='', checker, retryPolicy) {
		return await this.retriableRequest(path, 'POST', params, checker, retryPolicy || this.retryPolicy);
	}
}

module.exports = HttpTransport;

// var transport = new HttpTransport({host: 'a.ahoy.li', port: 18090});
// transport.get().then(console.log, console.error);
