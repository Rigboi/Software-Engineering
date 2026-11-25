// Identity is established by the application session middleware.
function authorize(req) {
  if (!req.user || !req.user.staffID || !req.user.name) return { ok: false, status: 401, message: 'Please log in to use the maintenance schedule.' };
  return { ok: true, user: req.user.name };
}
module.exports = { authorize };
