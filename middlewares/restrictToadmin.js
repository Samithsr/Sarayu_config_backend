const restrictToadmin = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.userRole) {
      console.error(`[RBAC] Role not found for user: ${req.userId}`);
      return res.status(403).json({ message: "Access denied: Role not found" });
    }

    const userRoles = Array.isArray(req.userRole) ? req.userRole : [req.userRole];
    const hasPermission = allowedRoles.some((role) => userRoles.includes(role));

    if (!hasPermission) {
      console.error(`[RBAC] User: ${req.userId} (Roles: ${JSON.stringify(userRoles)}) attempted to access restricted route. Allowed roles: ${allowedRoles}`);
      return res.status(403).json({ message: "Access denied: Insufficient permissions" });
    }

    console.log(`[RBAC] User: ${req.userId} (Roles: ${JSON.stringify(userRoles)}) granted access`);
    next();
  };
};

module.exports = restrictToadmin;