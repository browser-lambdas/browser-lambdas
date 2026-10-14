import { renderReviewPanel } from '../../src/pages/workspace/reviewView.js';

// The production renderer owns the review markup. Only the example data is staged.
document.querySelector('#review-preview').innerHTML = renderReviewPanel({
  id: 'store-demo', project: 'my-tools', items: [{
    type: 'lambda', action: 'update', name: 'self-destruct --sec',
    sourcePath: 'functions/self-destruct.js', project: 'my-tools',
    previous: { hash: 'a18d32f', func: 'const seconds = 10;' },
    incoming: { hash: 'c92e471', func: 'const seconds = Number(ctx.args.all().sec ?? 30);' }
  }]
});
document.documentElement.dataset.ready = 'true';
