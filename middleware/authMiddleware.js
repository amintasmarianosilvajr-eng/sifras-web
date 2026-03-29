const config = require('../config');

function authMiddleware(req, res, next) {
    const auth = req.headers.authorization;
    const token = auth ? auth.split(' ')[1] : req.query.password;
    if (token === config.MASTER_PASSWORD) return next();
    res.status(401).json({ error: "Acesso Negado" });
}

module.exports = authMiddleware;
