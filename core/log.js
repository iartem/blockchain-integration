'use strict';

const winston = require('winston'),
	CFG = require('./config.js').defaults,
	DEFAULT_LOG_LEVEL = 'monitor',
	moment = require('moment');

var currentLevel = CFG ? CFG.log : DEFAULT_LOG_LEVEL;

const format = winston.format.printf(info => {
	return `${info.timestamp} [${info.level.toUpperCase()}] ${info.label}: ${info.message}`;
});

const levels = {
	levels: {
		monitor: 2,
		error: 2, 
		warn: 3,
		info: 4,
		debug: 5,
	},
	colors: {
		monitor: 'white',
		error: 'red', 
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
			string = error;
			error = undefined;
		}

		if (error) {
			logger[level](`${string} / error ${error.message || error.code} stack ${JSON.stringify(error.stack)}`);
		} else {
			logger[level](string);
		}
	}

	return {
		monitor: logit.bind(null, 'monitor'),
		error: logit.bind(null, 'error'), 
		warn: logit.bind(null, 'warn'),
		info: logit.bind(null, 'info'),
		debug: logit.bind(null, 'debug'),
	};
};

module.exports.setLevel = (level) => {
	currentLevel = level;
	loggers.forEach(logger => {
		let prev = logger.level;
		logger.level = level;
		logger.transports.forEach(t => {
			// if (t.level === prev) {
				t.level = level;
			// }
		});
	});
};