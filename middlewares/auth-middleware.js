const jwt = require("jsonwebtoken");

const authMiddleware = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    console.error("[Auth] No token provided in request");
    return res.status(401).json({ message: "No token provided" });
  }

  const token = authHeader.split(" ")[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "x-auth-token");
    req.userId = decoded.sub || decoded._id;
    req.userRole = decoded.roles || decoded.role || null; // Handle 'roles' or 'role' in JWT
    if (!req.userRole) {
      console.error(`[Auth] No roles found in token for user: ${req.userId}`);
      return res.status(401).json({ message: "Invalid token: No roles specified" });
    }
    console.log(`[Auth] Token verified for user: ${req.userId}, roles: ${JSON.stringify(req.userRole)}`);
    next();
  } catch (error) {
    console.error(`[Auth] Token verification failed for token: ${token.slice(0, 10)}...: ${error.message}`);
    if (error.name === "TokenExpiredError") {
      return res.status(401).json({ message: "Token expired" });
    }
    return res.status(401).json({ message: "Invalid token" });
  }
};

module.exports = authMiddleware;