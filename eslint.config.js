//? Entry point for `eslint`. Spreads the two tiers — official plugins +
//? LuckyStack framework rules — so they can be edited and overridden
//? independently. See `eslint.official.config.js` and
//? `eslint.luckystack.config.js`.

import official from './eslint.official.config.js'
import luckystack from './eslint.luckystack.config.js'

export default [...official, ...luckystack]
