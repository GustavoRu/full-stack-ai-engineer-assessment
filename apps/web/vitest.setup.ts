import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Unmounts rendered components between tests
afterEach(cleanup);
