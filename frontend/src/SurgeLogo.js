import React from 'react';
import surgeLogo from './assets/Surge.png';

// The PNG is white-on-transparent. In light mode we invert it to
// black-on-transparent via a CSS filter — cheaper than maintaining
// two rendered variants of the asset.
const SurgeLogo = () => (
  <div style={{ display: 'flex', justifyContent: 'center', marginTop: 32 }}>
    <img
      className="surge-logo"
      src={surgeLogo}
      alt="Surge Logo"
      style={{ maxWidth: 180, maxHeight: 180 }}
    />
  </div>
);

export default SurgeLogo;
