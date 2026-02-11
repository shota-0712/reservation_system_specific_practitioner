/**
 * Repository Index
 * Export all PostgreSQL-based repositories
 */

// Tenant & Store (root level, no RLS on tenants)
export { TenantRepository, StoreRepository, createTenantRepository, createStoreRepository } from './tenant.repository.js';

// Core entities (with RLS)
export { PractitionerRepository, createPractitionerRepository } from './practitioner.repository.js';
export { MenuRepository, createMenuRepository } from './menu.repository.js';
export { OptionRepository, createOptionRepository } from './option.repository.js';
export { ReservationRepository, createReservationRepository, type ReservationFilters } from './reservation.repository.js';
export { CustomerRepository, createCustomerRepository, type CustomerFilters } from './customer.repository.js';
export {
    KarteRepository,
    KarteTemplateRepository,
    createKarteRepository,
    createKarteTemplateRepository
} from './karte.repository.js';
