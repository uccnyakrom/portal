/**
 * roles.js
 * PLACE THIS FILE AT: /js/roles.js
 * Defines permissions for each admin role level
 */

export const ROLE_PERMISSIONS = {
  "superadmin": {
    label: "Super Admin",
    sections: ["overview","rooms","reports","export","facilities","maintenance","notices"],
    canExport: true,
    canManageUsers: false,
    canEditStudents: false,
    canAssignRooms: false,
    canPublishNotices: false,
    canManageMaintenance: false,
    canDeleteRecords: false,
  },
  "admin": {
    label: "Administrator",
    sections: ["overview","students","rooms","allocations","applications","publicapps",
               "managerooms","reports","users","notices","export","audit",
               "facilities","bookings","maintenance"],
    canExport: true,
    canManageUsers: true,
    canEditStudents: true,
    canAssignRooms: true,
    canPublishNotices: true,
    canManageMaintenance: true,
    canDeleteRecords: true,
  },
  "accommodation": {
    label: "Accommodation Officer",
    sections: ["overview","students","rooms","allocations","applications",
               "notices","facilities","maintenance"],
    canExport: false,
    canManageUsers: false,
    canEditStudents: true,
    canAssignRooms: true,
    canEnrolStudents: false,
    canPublishNotices: true,
    canManageMaintenance: true,
    canDeleteRecords: false,
  },
  "facilities": {
    label: "Facilities Officer",
    sections: ["overview","rooms","facilities","bookings","maintenance"],
    canExport: false,
    canManageUsers: false,
    canEditStudents: false,
    canAssignRooms: false,
    canPublishNotices: false,
    canManageMaintenance: true,
    canDeleteRecords: false,
  },
  "monitor": {
    label: "Hall Monitor",
    sections: ["overview","rooms","maintenance"],
    canExport: false,
    canManageUsers: false,
    canEditStudents: false,
    canAssignRooms: false,
    canPublishNotices: false,
    canManageMaintenance: true,
    canDeleteRecords: false,
  },
  "readonly": {
    label: "Read-Only Staff",
    sections: ["overview"],
    canExport: false,
    canManageUsers: false,
    canEditStudents: false,
    canAssignRooms: false,
    canPublishNotices: false,
    canManageMaintenance: false,
    canDeleteRecords: false,
  },
};

/** Get permissions for a given role */
export function getPermissions(role) {
  return ROLE_PERMISSIONS[role] || ROLE_PERMISSIONS["readonly"];
}

/** Hide sidebar links the user doesn't have access to */
export function filterSidebarByRole(role) {
  const perms = getPermissions(role);
  document.querySelectorAll(".nav-link").forEach(link => {
    const section = link.dataset.section;
    if (section && !perms.sections.includes(section)) {
      link.parentElement?.style && (link.style.display = "none");
    }
  });

  // Hide action buttons based on permissions
  if (!perms.canDeleteRecords) {
    document.querySelectorAll(".btn-danger").forEach(b => {
      if (b.textContent.includes("🗑") || b.textContent.includes("Delete")) {
        b.style.display = "none";
      }
    });
  }
}

/** Coloured role badge HTML */
export function getRoleBadgeHTML(role) {
  const colors = {
    superadmin:    { bg: "#7c3aed", label: "Super Admin"           },
    admin:         { bg: "#1e3a5f", label: "Administrator"          },
    accommodation: { bg: "#0891b2", label: "Accommodation Officer"  },
    facilities:    { bg: "#059669", label: "Facilities Officer"     },
    monitor:       { bg: "#d97706", label: "Hall Monitor"           },
    readonly:      { bg: "#6b7280", label: "Read-Only Staff"        },
    student:       { bg: "#be185d", label: "Student"                },
  };
  const c = colors[role] || colors.readonly;
  return `<span style="background:${c.bg};color:#fff;padding:.2rem .6rem;border-radius:999px;font-size:11px;font-weight:700">${c.label}</span>`;
}
