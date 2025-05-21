const jwt = require("jsonwebtoken");


const authMiddleware = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    console.error("[Auth] No token provided in request");
    return res.status(401).json({ message: "No token provided" });
  }

  const token = authHeader.split(" ")[1];
  try {
    const decoded = jwt.verify(token, "x-auth-token");
    req.userId = decoded._id;
    req.userRole = decoded.role; // Attach role to req
    console.log(`[Auth] Token verified for user: ${req.userId}, role: ${req.userRole}`);
    next();
  } catch (error) {
    console.error(`[Auth] Invalid token: ${error.message}`);
    return res.status(401).json({ message: "Invalid token" });
  }
};

module.exports = authMiddleware;
