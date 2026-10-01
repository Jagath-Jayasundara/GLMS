function validateAndFormatNIC(nic) {
    if (!nic) return { isValid: false, message: 'NIC is required.' };
    const cleanNic = nic.toString().trim().toUpperCase();

    // Old format: 9 digits followed by 'V' or 'X' (or space then 'V'/'X')
    const oldNicRegex = /^(\d{9})\s?([VX])$/;
    // New format: exactly 12 digits
    const newNicRegex = /^\d{12}$/;

    if (oldNicRegex.test(cleanNic)) {
        const formatted = cleanNic.replace(/\s+/, '');
        return { isValid: true, formattedNIC: formatted, type: 'Old' };
    } else if (newNicRegex.test(cleanNic)) {
        return { isValid: true, formattedNIC: cleanNic, type: 'New' };
    }

    return { isValid: false, message: 'Invalid NIC format. Must be 9 digits + V/X (e.g. 123456789V) or 12 digits (e.g. 199012345678).' };
}

module.exports = {
    validateAndFormatNIC
};
