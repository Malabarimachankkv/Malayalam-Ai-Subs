// Simple HTTP Basic Auth in front of the review queue, gated by one shared
// password set as an env var. No usernames, no sessions, no database — this
// only needs to keep the queue away from random visitors, not manage
// individual team member accounts.
//
// Username can be anything; only the password is checked.

function requireAdminAuth(req, res, next) {
  const configured = process.env.ADMIN_PASSWORD;
  if (!configured) {
    return res
      .status(500)
      .send("ADMIN_PASSWORD is not set on the server — the queue can't be protected without it. Set it as an env var and redeploy.");
  }

  const header = req.headers.authorization || "";
  const [scheme, encoded] = header.split(" ");

  if (scheme === "Basic" && encoded) {
    const decoded = Buffer.from(encoded, "base64").toString("utf8");
    const separatorIndex = decoded.indexOf(":");
    const password = separatorIndex === -1 ? decoded : decoded.slice(separatorIndex + 1);
    if (password === configured) return next();
  }

  res.set("WWW-Authenticate", 'Basic realm="Malayalam AI Subs review queue"');
  return res.status(401).send("Authentication required.");
}

module.exports = { requireAdminAuth };
