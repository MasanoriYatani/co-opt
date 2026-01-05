/**
 * UI Update Module
 * Handles updating UI elements based on data changes
 */

/**
 * Update surface number select options
 */
export function updateSurfaceNumberSelect() {
    const surfaceNumberSelect = document.getElementById('surface-number-select');
    if (!surfaceNumberSelect) return;
    
    // Clear existing options
    surfaceNumberSelect.innerHTML = '<option value="">Select Surf</option>';
    
    // Get optical system data
    const opticalSystemData = window.tableOpticalSystem?.getData();
    if (!opticalSystemData || opticalSystemData.length === 0) {
        return;
    }
    
    // Add options for each surface
    opticalSystemData.forEach((surface, index) => {
        const option = document.createElement('option');
        option.value = index;
        option.textContent = `Surf ${index + 1}`;
        if (surface.comment) {
            option.textContent += ` - ${surface.comment}`;
        }
        surfaceNumberSelect.appendChild(option);
    });
}

/**
 * Update UI elements when data changes
 */
export function updateAllUIElements() {
    updateSurfaceNumberSelect();
}

/**
 * Initialize UI event listeners
 */
export function initializeUIEventListeners() {
    // Event listeners initialization can be added here if needed
}
