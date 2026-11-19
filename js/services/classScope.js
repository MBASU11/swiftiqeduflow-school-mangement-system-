// A tiny shared holder: which classes the signed-in teacher may see. null = no restriction.
// Filled by the router before each page renders (teacherService.refreshClassScope).
let allowed = null;
export const setClassScope = (idsOrNull) => { allowed = idsOrNull; };
export const scopedClasses = (list) => (allowed ? list.filter((c) => allowed.has(c.id)) : list);
export const scopedStudents = (list) => (allowed ? list.filter((s) => allowed.has(s.classId)) : list);
