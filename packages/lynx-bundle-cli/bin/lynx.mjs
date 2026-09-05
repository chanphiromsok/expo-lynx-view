#!/usr/bin/env node

import { execute } from '@oclif/core';
import { loadNearestDeliveryEnvironment } from '../src/env.mjs';

loadNearestDeliveryEnvironment();
await execute({ dir: import.meta.url });
