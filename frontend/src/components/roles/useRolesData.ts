import { useCallback, useEffect, useState } from 'react';
import api from '../../services/apiClient';
import { accessError } from './accessError';
import type { PermissionGroup, RolesData, TeamData } from './types';

export interface Loadable<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

const initial = <T>(wanted: boolean): Loadable<T> => ({ data: null, loading: wanted, error: null });
const busy = <T>(prev: Loadable<T>): Loadable<T> => ({ ...prev, loading: true, error: null });

/**
 * Everything the page needs, loaded in parallel and independently, so one failing request shows its
 * own error with "Try again" instead of hiding the rest. `wantRoles` / `wantTeam` say which parts
 * this person may read at all.
 */
export function useRolesData(wantRoles: boolean, wantTeam: boolean) {
  const [roles, setRoles] = useState<Loadable<RolesData>>(() => initial(wantRoles));
  const [catalogue, setCatalogue] = useState<Loadable<PermissionGroup[]>>(() => initial(wantRoles));
  const [team, setTeam] = useState<Loadable<TeamData>>(() => initial(wantTeam));

  // The fetchers only touch state after the request answers. `quiet` keeps what is on screen if it fails.
  const fetchRoles = useCallback(async (quiet = false) => {
    if (!wantRoles) return;
    try {
      const res = await api.get('/roles');
      setRoles({ data: res.data.data, loading: false, error: null });
    } catch (err) {
      setRoles(prev => ({ data: quiet ? prev.data : null, loading: false, error: accessError(err, 'Roles could not be loaded.', 'You don’t have permission to see this. Ask the owner if you need access.') }));
    }
  }, [wantRoles]);

  const fetchCatalogue = useCallback(async () => {
    if (!wantRoles) return;
    try {
      const res = await api.get('/roles/permissions');
      setCatalogue({ data: res.data.data, loading: false, error: null });
    } catch (err) {
      setCatalogue({ data: null, loading: false, error: accessError(err, 'The list of permissions could not be loaded.', 'You don’t have permission to see this. Ask the owner if you need access.') });
    }
  }, [wantRoles]);

  const fetchTeam = useCallback(async (quiet = false) => {
    if (!wantTeam) return;
    try {
      const res = await api.get('/team');
      setTeam({ data: res.data.data, loading: false, error: null });
    } catch (err) {
      setTeam(prev => ({ data: quiet ? prev.data : null, loading: false, error: accessError(err, 'The people list could not be loaded.', 'You don’t have permission to see this. Ask the owner if you need access.') }));
    }
  }, [wantTeam]);

  useEffect(() => {
    fetchRoles();
    fetchCatalogue();
    fetchTeam();
  }, [fetchRoles, fetchCatalogue, fetchTeam]);

  /** "Try again": show the loading state, then load. */
  const reloadRoles = () => {
    setRoles(busy);
    setCatalogue(busy);
    fetchRoles();
    fetchCatalogue();
  };
  const reloadTeam = () => {
    setTeam(busy);
    fetchTeam();
  };
  /** After a change: re-read the lists without flashing skeletons. */
  const refreshAll = useCallback(async () => {
    await Promise.all([fetchRoles(true), fetchTeam(true)]);
  }, [fetchRoles, fetchTeam]);

  return { roles, catalogue, team, reloadRoles, reloadTeam, refreshAll };
}
