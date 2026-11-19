import { uuid } from '../lib/uuid.js';
import { SupabaseRepository } from '../storage/SupabaseRepository.js';
import { getSupabaseClient } from './supabaseClient.js';

const repositories = {
  vehicles: new SupabaseRepository('vehicles'),
  routes: new SupabaseRepository('routes'),
  transportAssignments: new SupabaseRepository('transportAssignments'),
  students: new SupabaseRepository('students'),
};

export async function loadTransportWorkspace() {
  const [vehicles, routes, assignments, students] = await Promise.all([
    repositories.vehicles.getAll(),
    repositories.routes.getAll(),
    repositories.transportAssignments.getAll(),
    repositories.students.getAll(),
  ]);
  return { vehicles, routes, assignments, students };
}

export function transportCapacity(data, route) {
  return data.vehicles.find((vehicle) => vehicle.id === route.vehicleId)?.capacity ?? null;
}

export function assignmentsForRoute(data, routeId) {
  return data.assignments.filter((assignment) => assignment.routeId === routeId);
}

export function studentTransportAssignment(data, studentId) {
  return data.assignments.find((assignment) => assignment.studentId === studentId);
}

export async function createRemoteVehicle(vehicle) {
  return repositories.vehicles.create(vehicle, 'added vehicle');
}

export async function updateRemoteVehicle(vehicleId, vehicle) {
  const data = await loadTransportWorkspace();
  if (!data.vehicles.some((item) => item.id === vehicleId)) throw new Error('This vehicle no longer exists.');
  const affected = data.routes.find((route) => route.vehicleId === vehicleId &&
    assignmentsForRoute(data, route.id).length > Number(vehicle.capacity));
  if (affected) throw new Error(`Route ${affected.name} currently exceeds the new vehicle capacity.`);
  return repositories.vehicles.update(vehicleId, vehicle, 'updated vehicle');
}

export async function removeRemoteVehicle(vehicleId) {
  const data = await loadTransportWorkspace();
  if (data.routes.some((route) => route.vehicleId === vehicleId)) {
    throw new Error('This vehicle is assigned to a route. Unassign it from the route first.');
  }
  return repositories.vehicles.remove(vehicleId, 'removed vehicle');
}

export async function createRemoteRoute(route) {
  return repositories.routes.create(route, 'added transport route');
}

export async function updateRemoteRoute(routeId, route) {
  const data = await loadTransportWorkspace();
  const existing = data.routes.find((item) => item.id === routeId);
  if (!existing) throw new Error('This route no longer exists.');
  const capacity = data.vehicles.find((vehicle) => vehicle.id === route.vehicleId)?.capacity ?? null;
  if (capacity !== null && assignmentsForRoute(data, routeId).length > Number(capacity)) {
    throw new Error('The selected vehicle has fewer seats than the students currently assigned to this route.');
  }
  return repositories.routes.update(routeId, { ...route, stops: existing.stops ?? [] }, 'updated transport route');
}

export async function assignRemoteStudent(studentId, routeId, stopId) {
  const client = await getSupabaseClient();
  const { data, error } = await client.rpc('assign_student_transport', {
    target_student_id: studentId,
    target_route_id: routeId,
    target_stop_id: stopId || null,
  });
  if (error) throw error;
  return data;
}

export async function unassignRemoteStudent(studentId) {
  const client = await getSupabaseClient();
  const { error } = await client.rpc('unassign_student_transport', { target_student_id: studentId });
  if (error) throw error;
}

export async function addRemoteStop(routeId, stopName) {
  const route = await repositories.routes.getById(routeId);
  if (!route) throw new Error('The selected route could not be found.');
  return repositories.routes.update(routeId, {
    stops: [...(route.stops ?? []), { id: uuid(), name: stopName }],
  });
}

export async function removeRemoteStop(routeId, stopId) {
  const client = await getSupabaseClient();
  const { error } = await client.rpc('remove_transport_stop', { target_route_id: routeId, target_stop_id: stopId });
  if (error) throw error;
}

export async function removeRemoteRoute(routeId) {
  const client = await getSupabaseClient();
  const { error } = await client.rpc('remove_transport_route', { target_route_id: routeId });
  if (error) throw error;
}