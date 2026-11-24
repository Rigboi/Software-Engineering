// STAND-IN for the team's Authentication & Access Control component.
// Replace authorize() with a call to authService once it exists. Who counts as
// "authorized" is still an open item in the SRS (QA-05); for now any named MITS user is allowed.
function authorize(req) {
  const user = (req.headers['x-user'] || '').trim();
  if (!user) return { ok: false, status: 401, message: 'Please sign in to use the maintenance schedule.' };
  return { ok: true, user };
}
module.exports = { authorize };
