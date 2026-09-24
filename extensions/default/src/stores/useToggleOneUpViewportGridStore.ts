import { create } from 'zustand';

const PRESENTATION_TYPE_ID = 'toggleOneUpViewportGridId';

type ToggleOneUpViewportGridState = {
  toggleOneUpViewportGridStore: any | null;
  viewportPresentations: Map<string, any>;
  setToggleOneUpViewportGridStore: (state: any, viewportPresentations?: Map<string, any>) => void;
  clearToggleOneUpViewportGridStore: () => void;
  type: string;
};

// Stores the entire ViewportGridService getState when toggling to one up
// (e.g. via a double click) so that it can be restored when toggling back.
export const useToggleOneUpViewportGridStore = create<ToggleOneUpViewportGridState>(set => ({
  toggleOneUpViewportGridStore: null,
  viewportPresentations: new Map(),
  type: PRESENTATION_TYPE_ID,
  setToggleOneUpViewportGridStore: (state, viewportPresentations = new Map()) =>
    set({ toggleOneUpViewportGridStore: state, viewportPresentations }),
  clearToggleOneUpViewportGridStore: () =>
    set({ toggleOneUpViewportGridStore: null, viewportPresentations: new Map() }),
}));
