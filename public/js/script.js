// General JavaScript functionality
document.addEventListener('DOMContentLoaded', function() {
    // Auto-dismiss alerts after 5 seconds
    const alerts = document.querySelectorAll('.alert');
    alerts.forEach(alert => {
        setTimeout(() => {
            const bsAlert = new bootstrap.Alert(alert);
            bsAlert.close();
        }, 5000);
    });

    // Form validation enhancements
    const forms = document.querySelectorAll('form');
    forms.forEach(form => {
        form.addEventListener('submit', function(e) {
            const submitBtn = this.querySelector('button[type="submit"]');
            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status"></span> Processing...';
            }
        });
    });

    // Time slot availability checker
    const timeSlotCheckers = document.querySelectorAll('[data-time-slot-checker]');
    timeSlotCheckers.forEach(checker => {
        checker.addEventListener('change', function() {
            // Implementation for real-time slot checking
        });
    });
});

// Utility functions
function formatTime(timeString) {
    return new Date('1970-01-01T' + timeString).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
}

function formatDate(dateString) {
    return new Date(dateString).toLocaleDateString();
}