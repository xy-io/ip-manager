// ============================================================
//  Domain store
//
//  Trivial accessors, but shared: the Domain Tracker routes own the RDAP
//  logic while the Home Assistant endpoints only need to read the list.
//  Keeping them here stops either side reaching into the other.
// ============================================================

'use strict';

const { dbGet, dbSet } = require('./db');

const getDomains = () => dbGet('domains') || [];
const saveDomains = (domains) => dbSet('domains', domains);

module.exports = { getDomains, saveDomains };
