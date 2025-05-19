const restrictToadmin = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.userRole) {
      console.error(`[RBAC] Role not found for user: ${req.userId}`);
      return res.status(403).json({ message: "Access denied: Role not found" });
    }

    if (!allowedRoles.includes(req.userRole)) {
      console.error(`[RBAC] User: ${req.userId} (Role: ${req.userRole}) attempted to access restricted route`);
      return res.status(403).json({ message: "Access denied: Insufficient permissions" });
    }

    console.log(`[RBAC] User: ${req.userId} (Role: ${req.userRole}) granted access`);
    next();
  };
};

module.exports = restrictToadmin;