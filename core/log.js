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
			new winston.transports.File({ filename: CFG ? `${CFG.chain}-error.log` : 'default-error.log', level: 'error' }),
			new winston.transports.File({ filename: CFG ? `${CFG.chain}.log` : 'default.log' })
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

	return logger;
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