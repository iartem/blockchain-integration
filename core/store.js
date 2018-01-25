const redis = require('redis'),
	{promisify} = require('util');

class RedisStore {
	constructor(CFG, log) {
		this.connected = false;
		this.connectionErrors = 0;
		this.log = log('store');
		this.CFG = CFG;
	}

	connect () {
		return this.connectPromise || this.reconnect();
	}

	close () {
		return this.redis.quit();
	}

	reconnect () {
		if (this.redis) {
			this.close();
		}

		this.redis = redis.createClient({
			url: this.CFG.store,
			connect_timeout: 3000,
			retry_strategy: (opts) => {
				if (opts.error && opts.error.code === 'ECONNREFUSED') {
					// End reconnecting on a specific error and flush all commands with
					// a individual error
					return new Error('The server refused the connection');
				}
				if (opts.total_retry_time > 1000 * 3 * 60) {
					// End reconnecting after a specific timeout and flush all commands
					// with a individual error
					return new Error('Retry time exhausted');
				}
				if (opts.attempt > 3) {
					// End reconnecting with built in error
					return undefined;
				}
				// reconnect after
				return Math.min(opts.attempt * 100, 3000);
			}
		});
		this.get = promisify(this.redis.get).bind(this.redis);
		this.set = promisify(this.redis.set).bind(this.redis);
		this.del = promisify(this.redis.del).bind(this.redis);
		this.exists = promisify(this.redis.exists).bind(this.redis);
		this.setnx = promisify(this.redis.setnx).bind(this.redis);
		this.getset = promisify(this.redis.getset).bind(this.redis);
		this.zadd = promisify(this.redis.zadd).bind(this.redis);
		this.zrem = promisify(this.redis.zrem).bind(this.redis);
		this.zscore = promisify(this.redis.zscore).bind(this.redis);
		this.zincrby = promisify(this.redis.zincrby).bind(this.redis);
		this.zrange = promisify(this.redis.zrange).bind(this.redis);
		this.zrangebyscore = promisify(this.redis.zrangebyscore).bind(this.redis);
		this.zcount = promisify(this.redis.zcount).bind(this.redis);
		this.hexists = promisify(this.redis.hexists).bind(this.redis);
		this.hmset = promisify(this.redis.hmset).bind(this.redis);
		this.hmget = promisify(this.redis.hmget).bind(this.redis);
		this.hget = promisify(this.redis.hget).bind(this.redis);
		this.hset = promisify(this.redis.hset).bind(this.redis);
		this.hgetall = promisify(this.redis.hgetall).bind(this.redis);
		
		this.connectPromise = new Promise((resolve, reject) => {
			this.redis.on('connect', () => {
				this.connected = true;
				this.connectionErrors = 0;
				this.connectPromise = null;
				resolve(this);
			});
			this.redis.on('error', err => {
				if (!this.connected) {
					this.connectionErrors++;
				}
				this.log.error(`Error in store: ${err.message || 'Unknown error'}`);

				if (this.connectionErrors < 3) {
					this.reconnect().then(resolve, reject);
				} else {
					this.connected = false;
					this.connectionErrors = 0;
					this.connectPromise = null;
					this.close();
					reject(err);
				}
			});
			if (this.redis.connected) {
				this.connected = true;
				this.connectionErrors = 0;
				this.connectPromise = null;
				resolve(this);
			}
		});

		return this.connectPromise;
	}

	toObject(data) {
		if (typeof data === 'object' && data.length) {
			let obj = {};
			data.forEach((v, i) => {
				if (i % 2 === 0) {
					obj[v] = data[i + 1];
				}
			});
			return obj;
		}
	}
}

module.exports = RedisStore;
