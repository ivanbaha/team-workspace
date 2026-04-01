import { createSlice } from '@reduxjs/toolkit';

const authSlice = createSlice({
  name: 'auth',
  initialState: { user: null, token: null, status: 'idle' },
  reducers: {
    setCredentials(state, action) {
      state.user = action.payload.user;
      state.token = action.payload.token;
      state.status = 'idle';
    },
    clearCredentials(state) {
      state.user = null;
      state.token = null;
      state.status = 'idle';
    },
  },
});

export const { setCredentials, clearCredentials } = authSlice.actions;
export default authSlice.reducer;
