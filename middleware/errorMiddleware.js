function errorMiddleware(err, req, res, next) {
    console.error("ERROR HANDLER:", err.message);
    const status = err.status || 500;
    res.status(status).json({
        error: err.message || "Erro Interno do Servidor",
        timestamp: new Date().toISOString()
    });
}

module.exports = errorMiddleware;
