/**
 * Database utilities index
 * Re-exports migration and seed modules for direct access
 */

const migrate = require('./migrate.js');
const seeds = require('./seeds.js');

module.exports = {
    migrate,
    seeds
};
