import { LocalStorageRepository } from '../storage/Repository.js';
import { uuid } from '../lib/uuid.js';
import { studentRepo } from './studentService.js';

export const vehicleRepo = new LocalStorageRepository('vehicles', 'vehicle');
export const routeRepo = new LocalStorageRepository('routes', 'route');
export const transportAssignmentRepo = new LocalStorageRepository('transportAssignments', 'transport assignment');

export function getAssignmentsForRoute(routeId) {
  return transportAssignmentRepo.find((a) => a.routeId === routeId);
}

export function getAssignmentForStudent(studentId) {
  return transportAssignmentRepo.find((a) => a.studentId === studentId)[0];
}

export function routeOccupancy(routeId) {
  return getAssignmentsForRoute(routeId).length;
}

export function routeCapacity(route) {
  const vehicle = route.vehicleId ? vehicleRepo.getById(route.vehicleId) : undefined;
  return vehicle?.capacity ?? null;
}

export function updateVehicle(vehicleId, vehicle) {
  const affectedRoutes = routeRepo.find((route) => route.vehicleId === vehicleId);
  const overCapacity = affectedRoutes.find((route) => getAssignmentsForRoute(route.id).length > Number(vehicle.capacity));
  if (overCapacity) throw new Error(`Route ${overCapacity.name} currently exceeds the new vehicle capacity.`);
  return vehicleRepo.update(vehicleId, vehicle, 'updated vehicle');
}

export function updateRoute(routeId, route) {
  const capacity = route.vehicleId ? routeCapacity({ vehicleId: route.vehicleId }) : null;
  if (capacity !== null && getAssignmentsForRoute(routeId).length > capacity) {
    throw new Error('The selected vehicle has fewer seats than the students currently assigned to this route.');
  }
  return routeRepo.update(routeId, { ...route, stops: routeRepo.getById(routeId)?.stops ?? [] }, 'updated transport route');
}

// Assigns a student to a route/stop. One assignment per student — assigning
// again replaces the previous one rather than creating a duplicate. Also
// keeps Student.usesTransport in sync so other modules (profile, forms)
// reflect it without needing to know about routes.
export function assignStudent(studentId, routeId, stopId) {
  const existing = getAssignmentForStudent(studentId);
  if (existing) {
    transportAssignmentRepo.update(existing.id, { routeId, stopId }, 'reassigned transport route');
  } else {
    transportAssignmentRepo.create({ studentId, routeId, stopId }, 'assigned transport route');
  }
  studentRepo.update(studentId, { usesTransport: true });
}

export function unassignStudent(studentId) {
  const existing = getAssignmentForStudent(studentId);
  if (existing) transportAssignmentRepo.remove(existing.id, 'unassigned transport route');
  studentRepo.update(studentId, { usesTransport: false });
}

export function removeRoute(routeId) {
  getAssignmentsForRoute(routeId).forEach((assignment) => unassignStudent(assignment.studentId));
  return routeRepo.remove(routeId, 'removed route');
}

export function addStop(routeId, stopName) {
  const route = routeRepo.getById(routeId);
  if (!route) return;
  const stops = [...(route.stops || []), { id: uuid(), name: stopName }];
  routeRepo.update(routeId, { stops });
}

export function removeStop(routeId, stopId) {
  const route = routeRepo.getById(routeId);
  if (!route) return;
  // Unassign anyone using this stop before removing it, so assignments
  // never point at a stop that no longer exists.
  getAssignmentsForRoute(routeId)
    .filter((a) => a.stopId === stopId)
    .forEach((a) => unassignStudent(a.studentId));
  routeRepo.update(routeId, { stops: (route.stops || []).filter((s) => s.id !== stopId) });
}
