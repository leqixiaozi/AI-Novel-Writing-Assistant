import type {BookOverviewMetric} from '../../common/contracts';

export function nextOverviewMetric(metrics:BookOverviewMetric[]):BookOverviewMetric|null {
 return metrics.find(item=>item.state==='attention'&&item.sourceRoute)||metrics.find(item=>item.state==='unknown'&&item.sourceRoute)||null;
}
