'use strict';

const winston = require('winston'),
	CFG = require('./config.js').defaults,
	DEFAULT_LOG_LEVEL = 'monitor',
	moment = require('moment'),
	WinstonTransport = require('winston-transport');

var currentLevel = CFG ? CFG.log : DEFAULT_LOG_LEVEL;

const format = winston.format.printf(info => {
	return `${info.timestamp} [${info.level.toUpperCase()}] ${info.label}: ${info.message}`;
});

const levels = {
	levels: {
		monitor: 2,
		error: 2, 
		fatal: 2, 
		warn: 3,
		info: 4,
		debug: 5,
	},
	colors: {
		monitor: 'white',
		error: 'red', 
		fatal: 'red', 
		warn: 'orange',
		info: 'blue',
		verbose: 'green',
		debug: 'white',
	}
};

const loggers = [];

module.exports = label => {
	const labelledFormat = winston.format.combine(
		winston.format.label({ label: label }),
		winston.format(info => {
			info.timestamp = moment().format('YYYY-MM-DD HH:mm:ss:SSS');
			return info;
		})(),
		format
	);
	const logger = winston.createLogger({
		level: currentLevel,
		format: labelledFormat,
		levels: levels.levels,
		transports: [
			new winston.transports.File({ filename: CFG ? `${CFG.chain}-error.log` : 'default-error.log', level: 'error' })
		]
	});

	winston.addColors(levels);

	if (process.env.NODE_ENV === 'production') {
		logger.add(new winston.transports.Console({
			level: currentLevel,
			format: labelledFormat
		}));
	} else {
		logger.add(new winston.transports.Console({
			format: labelledFormat
		}));
	}

	loggers.push(logger);

	function logit(level, error, string) {
		if (!(error instanceof Error)) {
			if (error && string) {
				logger[level](`${string} / error ${error.message || error.code} obj ${JSON.stringify(error)}}`);
				return;
			} else {
				string = error;
				error = undefined;
			}
		}

		if (error) {
			logger[level](`${string} / error ${error.message || error.code} stack ${JSON.stringify(error.stack)}`);
		} else {
			logger[level](typeof string === 'object' ? JSON.stringify(string) : string);
		}
	}

	return {
		monitor: logit.bind(null, 'monitor'),
		error: logit.bind(null, 'error'), 
		fatal: logit.bind(null, 'fatal'), 
		warn: logit.bind(null, 'warn'),
		info: logit.bind(null, 'info'),
		debug: logit.bind(null, 'debug'),
	};
};

module.exports.setLevel = (level) => {
	currentLevel = level;
	loggers.forEach(logger => {
		logger.level = level;
		logger.transports.forEach(t => {
			t.level = level;
		});
	});
};

module.exports.setUpHTTP = (serviceName, url) => {

	var levelMap = {
		debug: 'info',
		info: 'info',
		error: 'error',
		fatal: 'fatalError',
		warn: 'warning',
		monitor: 'monitor'
	};

	class HttpTransport extends WinstonTransport {
		constructor(opts) {
			super(opts);

			var Transport = require('./transport.js');
			this.transport = new Transport({url: opts.url, retryPolicy:(error, attempts) => {
				return error === 'timeout' || (error === null && attempts < 3);
			}, conf: {timeout: 15000, headers: {accept: 'application/json'}}});
		}

		log (info, callback) {
			try {
				if (info.label === 'transport') {
					return callback();
				}
				// console.log(info);

				let data = {
					appName: serviceName,
					appVersion: '1.0.0',
					envInfo: process.env.ENV_INFO || null,
					logLevel: levelMap[info.level],
					component: info.label,
					message: info.message,
					additionalSlackChannels: ['warn', 'error', 'fatal', 'monitor'].indexOf(info.level) !== -1 ? ['BlockChainIntegrationImportantMessages', 'BlockChainIntegration'] : ['BlockChainIntegration']
				};

				console.log(data);

				this.transport.retriableRequest(null, 'POST', data).then(callback.bind(null, null), callback);

				// setImmediate(callback);
			} catch(e) {
				console.log(e);
			}
		}
	}

	let http = new HttpTransport({url: url});
	http.level = currentLevel;

	loggers.forEach(logger => {
		logger.add(http);
	});
};