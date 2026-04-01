import { createSlice } from '@reduxjs/toolkit';

const uiSlice = createSlice({
  name: 'ui',
  initialState: { sidebarOpen: true, globalLoading: false },
  reducers: {
    toggleSidebar(state) {
      state.sidebarOpen = !state.sidebarOpen;
    },
    setGlobalLoading(state, action) {
      state.globalLoading = action.payload;
    },
  },
});

export const { toggleSidebar, setGlobalLoading } = uiSlice.actions;
export default uiSlice.reducer;
