// Mark paragraphs that contain only an empty anchor element with 'no-text' class
(function() {
    function markEmptyAnchorParagraphs() {
        const paragraphs = document.querySelectorAll('p');
        
        paragraphs.forEach(p => {
            // Get all child nodes (including text nodes)
            const children = Array.from(p.childNodes);
            
            // Check if there's exactly one child and it's an empty anchor
            if (children.length === 1 && 
                children[0].nodeType === Node.ELEMENT_NODE && 
                children[0].tagName === 'A' && 
                children[0].textContent.trim() === '') {
                p.classList.add('no-text');
            }
            // Also check for paragraphs with only an anchor and whitespace text nodes
            else {
                const nonEmptyNodes = children.filter(node => {
                    if (node.nodeType === Node.TEXT_NODE) {
                        return node.textContent.trim() !== '';
                    }
                    return true;
                });
                
                if (nonEmptyNodes.length === 1 && 
                    nonEmptyNodes[0].nodeType === Node.ELEMENT_NODE && 
                    nonEmptyNodes[0].tagName === 'A' && 
                    nonEmptyNodes[0].textContent.trim() === '') {
                    p.classList.add('no-text');
                }
            }
        });
    }
    
    // Run when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', markEmptyAnchorParagraphs);
    } else {
        markEmptyAnchorParagraphs();
    }
    
    // Also observe for dynamically added content
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            mutation.addedNodes.forEach((node) => {
                if (node.nodeType === Node.ELEMENT_NODE) {
                    if (node.tagName === 'P') {
                        const children = Array.from(node.childNodes);
                        const nonEmptyNodes = children.filter(n => {
                            if (n.nodeType === Node.TEXT_NODE) {
                                return n.textContent.trim() !== '';
                            }
                            return true;
                        });
                        
                        if (nonEmptyNodes.length === 1 && 
                            nonEmptyNodes[0].nodeType === Node.ELEMENT_NODE && 
                            nonEmptyNodes[0].tagName === 'A' && 
                            nonEmptyNodes[0].textContent.trim() === '') {
                            node.classList.add('no-text');
                        }
                    } else if (node.querySelectorAll) {
                        // Check nested paragraphs
                        node.querySelectorAll('p').forEach(p => {
                            const children = Array.from(p.childNodes);
                            const nonEmptyNodes = children.filter(n => {
                                if (n.nodeType === Node.TEXT_NODE) {
                                    return n.textContent.trim() !== '';
                                }
                                return true;
                            });
                            
                            if (nonEmptyNodes.length === 1 && 
                                nonEmptyNodes[0].nodeType === Node.ELEMENT_NODE && 
                                nonEmptyNodes[0].tagName === 'A' && 
                                nonEmptyNodes[0].textContent.trim() === '') {
                                p.classList.add('no-text');
                            }
                        });
                    }
                }
            });
        });
    });
    
    observer.observe(document.body, {
        childList: true,
        subtree: true
    });
})();
